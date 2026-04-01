"""
setup_rag.py  —  Rate My Professor RAG API  v3.0
================================================
Enhancements over v2:
  • Redis-based semantic caching (TTL configurable)
  • MMR (Maximal Marginal Relevance) for diversity-aware retrieval
  • Cross-encoder reranking via sentence-transformers
  • Evaluation metrics: MRR, Hit@K, Context Precision, Answer Relevance
  • /api/eval  endpoint to run offline evaluation
  • /api/metrics  endpoint to expose live evaluation dashboard data
  • Prometheus-style counters for latency, cache hits, rerank gain
  • Async-safe Redis with aioredis
"""

import os, json, uuid, time, asyncio, hashlib, logging
from typing import Optional, List, Dict, Any

os.environ["TOKENIZERS_PARALLELISM"] = "false"
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("rmp")

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import uvicorn
import nltk
nltk.download("vader_lexicon", quiet=True)
from nltk.sentiment import SentimentIntensityAnalyzer

from dotenv import load_dotenv
load_dotenv()

from pinecone import Pinecone, ServerlessSpec
from sentence_transformers import SentenceTransformer, CrossEncoder

from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate, SystemMessagePromptTemplate, HumanMessagePromptTemplate
from langchain_core.messages import HumanMessage, AIMessage

try:
    from langfuse.langchain import CallbackHandler as LangfuseCallbackHandler
    LANGFUSE_ENABLED = True
except ImportError:
    LANGFUSE_ENABLED = False
    log.warning("langfuse not installed — tracing disabled.")

try:
    import redis.asyncio as aioredis
    REDIS_ENABLED = True
except ImportError:
    REDIS_ENABLED = False
    log.warning("redis not installed — caching disabled. pip install redis")

import numpy as np

embed_model   = SentenceTransformer("all-MiniLM-L6-v2")
rerank_model  = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
sia           = SentimentIntensityAnalyzer()

pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))

llm = ChatGroq(
    model="llama-3.3-70b-versatile",
    groq_api_key=os.getenv("GROQ_API_KEY"),
    temperature=0.3,
    max_tokens=600,
    streaming=True,
)

INDEX_NAME = "rag"
NAMESPACE  = "ns1"
CACHE_TTL  = int(os.getenv("CACHE_TTL_SECONDS", "3600"))   
MMR_LAMBDA = float(os.getenv("MMR_LAMBDA", "0.7"))          
_metrics: Dict[str, Any] = {
    "total_queries":      0,
    "cache_hits":         0,
    "cache_misses":       0,
    "total_latency_ms":   0.0,
    "rerank_calls":       0,
    "avg_rerank_gain":    0.0,   
    "eval_runs":          [],   
}

existing = [idx["name"] for idx in pc.list_indexes()]
if INDEX_NAME not in existing:
    log.info(f"Creating Pinecone index '{INDEX_NAME}'...")
    pc.create_index(
        name=INDEX_NAME,
        dimension=384,
        metric="cosine",
        spec=ServerlessSpec(cloud="aws", region="us-east-1"),
    )
    time.sleep(5)

    reviews_path = os.getenv("REVIEWS_PATH", "reviews.json")
    data = json.load(open(reviews_path))
    log.info(f"Loaded {len(data['reviews'])} reviews, embedding...")

    processed_data = []
    for i, review in enumerate(data["reviews"]):
        score = sia.polarity_scores(review["review"])["compound"]
        processed_data.append({
            "id": f"{review['professor'].replace(' ', '_')}_{i}",
            "values": embed_model.encode(review["review"]).tolist(),
            "metadata": {
                "professor":        review["professor"],
                "review":           review["review"],
                "subject":          review["subject"],
                "stars":            review["stars"],
                "teaching_style":   review.get("teaching_style", ""),
                "difficulty_level": review.get("difficulty_level", ""),
                "availability":     review.get("availability", ""),
                "sentiment_score":  round(score, 4),
                "sentiment_label": (
                    "positive" if score >= 0.05
                    else "negative" if score <= -0.05
                    else "neutral"
                ),
            },
        })

    index = pc.Index(INDEX_NAME)
    for start in range(0, len(processed_data), 100):
        batch = processed_data[start:start + 100]
        index.upsert(vectors=batch, namespace=NAMESPACE)
        log.info(f"Upserted batch ending at {start + len(batch)}")
    log.info("Seeding complete.")
else:
    log.info(f"Index '{INDEX_NAME}' already exists — skipping seeding.")

index = pc.Index(INDEX_NAME)
redis_client: Optional[Any] = None

async def get_redis():
    global redis_client
    if not REDIS_ENABLED:
        return None
    if redis_client is None:
        try:
            redis_client = aioredis.from_url(
                os.getenv("REDIS_URL", "redis://localhost:6379"),
                encoding="utf-8",
                decode_responses=True,
            )
            await redis_client.ping()
            log.info("Redis connected ✓")
        except Exception as e:
            log.warning(f"Redis unavailable: {e} — running without cache.")
            redis_client = None
    return redis_client

def cache_key(prefix: str, payload: dict) -> str:
    h = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]
    return f"rmp:{prefix}:{h}"

# MMR (Maximal Marginal Relevance) 
def mmr_rerank(
    query_vec: List[float],
    candidates: List[dict],
    top_k: int = 5,
    lambda_: float = MMR_LAMBDA,
) -> List[dict]:
    """
    MMR selects results that are both relevant to the query AND diverse
    from each other. lambda_=1.0 → pure relevance; lambda_=0.0 → pure diversity.
    """
    if not candidates:
        return []

    cand_vecs = np.array([embed_model.encode(c["metadata"]["review"]) for c in candidates])
    q_vec     = np.array(query_vec)

    # cosine sim between query and each candidate
    rel_scores = cand_vecs @ q_vec / (
        np.linalg.norm(cand_vecs, axis=1) * np.linalg.norm(q_vec) + 1e-9
    )

    selected_idx: List[int] = []
    remaining   = list(range(len(candidates)))

    while len(selected_idx) < min(top_k, len(candidates)):
        if not selected_idx:
            best = int(np.argmax([rel_scores[i] for i in remaining]))
            chosen = remaining[best]
        else:
            sel_vecs = cand_vecs[selected_idx]
            scores   = []
            for i in remaining:
                sim_to_sel = (cand_vecs[i] @ sel_vecs.T) / (
                    np.linalg.norm(cand_vecs[i]) * np.linalg.norm(sel_vecs, axis=1) + 1e-9
                )
                mmr_score = lambda_ * rel_scores[i] - (1 - lambda_) * float(sim_to_sel.max())
                scores.append((i, mmr_score))
            chosen = max(scores, key=lambda x: x[1])[0]

        selected_idx.append(chosen)
        remaining.remove(chosen)

    return [candidates[i] for i in selected_idx]
 
def crossencoder_rerank(query: str, candidates: List[dict], top_k: int = 5) -> List[dict]:
    """Re-score candidate reviews against the query using a cross-encoder."""
    if not candidates:
        return []
    pairs  = [(query, c["metadata"]["review"]) for c in candidates]
    scores = rerank_model.predict(pairs).tolist()

    orig_top = candidates[0]["metadata"]["professor"] if candidates else ""
    ranked   = sorted(zip(scores, candidates), key=lambda x: x[0], reverse=True)

    _metrics["rerank_calls"] += 1
    new_top = ranked[0][1]["metadata"]["professor"] if ranked else ""
    if new_top != orig_top:
        prev = _metrics["avg_rerank_gain"]
        n    = _metrics["rerank_calls"]
        _metrics["avg_rerank_gain"] = prev + (1.0 - prev) / n   

    return [c for _, c in ranked[:top_k]]

def embed(text: str) -> List[float]:
    return embed_model.encode(text).tolist()

def build_filter(params: dict) -> Optional[dict]:
    f: dict = {}
    if params.get("teachingStyle"):
        f["teaching_style"]  = {"$eq": params["teachingStyle"]}
    if params.get("difficultyLevel"):
        f["difficulty_level"] = {"$eq": params["difficultyLevel"]}
    if params.get("subject"):
        f["subject"]         = {"$eq": params["subject"]}
    if params.get("availability"):
        f["availability"]    = {"$eq": params["availability"]}
    if params.get("sentiment"):
        f["sentiment_label"] = {"$eq": params["sentiment"]}
    if params.get("excludeBelow") and isinstance(params["excludeBelow"], int):
        f["stars"]           = {"$gte": params["excludeBelow"]}
    return f or None

def format_context(matches: List[dict]) -> str:
    lines = []
    for m in matches:
        meta = m["metadata"]
        lines.append(
            f"• Professor: {meta.get('professor')} | "
            f"Subject: {meta.get('subject')} | "
            f"Stars: {meta.get('stars')}/5 | "
            f"Style: {meta.get('teaching_style', 'N/A')} | "
            f"Difficulty: {meta.get('difficulty_level', 'N/A')} | "
            f"Sentiment: {meta.get('sentiment_label', 'N/A')}\n"
            f"  Review: \"{meta.get('review')}\""
        )
    return "\n\n".join(lines)

def sort_professors(professors: List[dict], sort_by: str) -> List[dict]:
    if sort_by == "highest_rated":
        return sorted(professors, key=lambda x: x.get("stars", 0), reverse=True)
    if sort_by == "lowest_rated":
        return sorted(professors, key=lambda x: x.get("stars", 0))
    return professors

# Evaluation helpers 
def compute_mrr(ranked_results: List[dict], relevant_ids: List[str]) -> float:
    """Mean Reciprocal Rank — how high does the first relevant result appear?"""
    for rank, r in enumerate(ranked_results, 1):
        if r.get("id") in relevant_ids:
            return 1.0 / rank
    return 0.0

def compute_hit_at_k(ranked_results: List[dict], relevant_ids: List[str], k: int = 5) -> float:
    """Hit@K — did any relevant result appear in top K?"""
    top_k_ids = {r.get("id") for r in ranked_results[:k]}
    return 1.0 if top_k_ids & set(relevant_ids) else 0.0

def compute_context_precision(retrieved: List[dict], query: str) -> float:
    """
    Context Precision: fraction of retrieved docs that are semantically
    relevant to the query (cosine sim > threshold).
    """
    if not retrieved:
        return 0.0
    q_vec = np.array(embed(query))
    threshold = 0.4
    hits = 0
    for r in retrieved:
        r_vec = np.array(embed(r["metadata"]["review"]))
        sim   = float(q_vec @ r_vec / (np.linalg.norm(q_vec) * np.linalg.norm(r_vec) + 1e-9))
        if sim >= threshold:
            hits += 1
    return hits / len(retrieved)

def compute_answer_relevance(answer: str, query: str) -> float:
    """
    Answer Relevance (lightweight): cosine sim between answer embedding and query.
    In production replace with G-Eval or RAGAS.
    """
    q_vec = np.array(embed(query))
    a_vec = np.array(embed(answer))
    return float(q_vec @ a_vec / (np.linalg.norm(q_vec) * np.linalg.norm(a_vec) + 1e-9))

# ── LangChain prompt ──────────────────────────────────────────────────────────
SYSTEM_TEMPLATE = """You are an expert Rate My Professor AI assistant helping students find the best professors.

STRICT RULES:
- Use ONLY the professor data provided below. Never invent professors or reviews.
- Always cite the professor name and subject when referencing a review.
- If no relevant data is found, say so honestly.
- Use bullet points when comparing multiple professors.
- Be concise, helpful, and student-friendly.
- When professors are sorted by rating, mention the order.

── Retrieved Professor Data ─────────────────────────
{context}
─────────────────────────────────────────────────────

FEW-SHOT EXAMPLES:
Q: "Who is the best math professor?"
A: "Based on the reviews, **Dr. Alice Johnson** (Mathematics, ⭐5/5) is highly rated."

Q: "Show me professors sorted by highest rating"
A: "Here are professors ranked high→low: 1. **Dr. Alice Johnson** (⭐5/5)..."
"""

prompt = ChatPromptTemplate.from_messages([
    SystemMessagePromptTemplate.from_template(SYSTEM_TEMPLATE),
    HumanMessagePromptTemplate.from_template("{question}"),
])

app = FastAPI(title="Rate My Professor RAG API", version="3.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class Message(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: List[Message]
    filters: Optional[dict] = {}
    use_mmr: bool = True
    use_rerank: bool = True

class RateRequest(BaseModel):
    professorName: str
    review: str
    subject: Optional[str] = ""
    teachingStyle: Optional[str] = ""
    difficultyLevel: Optional[str] = ""
    availability: Optional[str] = ""
    stars: Optional[int] = 5
    userId: Optional[str] = "anonymous"

class SearchRequest(BaseModel):
    query: Optional[str] = "find professors"
    teachingStyle: Optional[str] = ""
    difficultyLevel: Optional[str] = ""
    subject: Optional[str] = ""
    availability: Optional[str] = ""
    professorName: Optional[str] = ""
    sentiment: Optional[str] = ""
    sortBy: Optional[str] = ""
    excludeBelow: Optional[int] = None
    use_mmr: bool = False     
    use_rerank: bool = True    

class EvalRequest(BaseModel):
    """Run offline evaluation against a gold-standard dataset."""
    eval_set: List[dict] = Field(
        ...,
        description="List of {query, relevant_ids: [str]} objects",
        example=[{"query": "best physics professor", "relevant_ids": ["prof_A_0"]}],
    )
    top_k: int = 5

@app.post("/api/chat")
async def chat(req: ChatRequest):
    if not req.messages:
        raise HTTPException(status_code=400, detail="No messages provided")

    t0 = time.time()
    user_query = req.messages[-1].content
    _metrics["total_queries"] += 1

    r = await get_redis()
    ck = cache_key("chat", {"q": user_query, "f": req.filters})
    if r:
        cached = await r.get(ck)
        if cached:
            _metrics["cache_hits"] += 1
            log.info(f"Cache HIT for query: {user_query[:60]}")
            async def _cached_stream():
                yield cached
            return StreamingResponse(_cached_stream(), media_type="text/plain")
        _metrics["cache_misses"] += 1

    # ── Pinecone retrieval ─────────────────────────────────────────────────────
    query_vec    = embed(user_query)
    pf           = {k: v for k, v in (req.filters or {}).items()
                    if k not in ("sortBy", "sentiment", "excludeBelow")}
    pc_filter    = build_filter(pf) if pf else None

    q_kwargs = {
        "vector": query_vec, "top_k": 20,
        "namespace": NAMESPACE, "include_metadata": True,
    }
    if pc_filter:
        q_kwargs["filter"] = pc_filter

    results  = index.query(**q_kwargs)
    matches  = results.get("matches", [])

    if req.use_mmr and matches:
        matches = mmr_rerank(query_vec, matches, top_k=10, lambda_=MMR_LAMBDA)
        log.info(f"MMR applied → {len(matches)} diverse candidates")

    if req.use_rerank and matches:
        matches = crossencoder_rerank(user_query, matches, top_k=5)
        log.info(f"Cross-encoder rerank applied → top 5")

    sort_by = (req.filters or {}).get("sortBy", "")
    if sort_by and matches:
        as_profs = [{"metadata": m["metadata"], "stars": m["metadata"].get("stars", 0)} for m in matches]
        as_profs = sort_professors(as_profs, sort_by)
        matches  = [{"metadata": p["metadata"], "score": 0} for p in as_profs]

    context      = format_context(matches) if matches else "No relevant professor data found."
    lc_messages  = prompt.format_messages(context=context, question=user_query)
    history: List = []
    for msg in req.messages[:-1]:
        history.append(HumanMessage(content=msg.content) if msg.role == "user"
                       else AIMessage(content=msg.content))
    final_messages = lc_messages[:1] + history + lc_messages[1:]

    callbacks = []
    if LANGFUSE_ENABLED:
        callbacks.append(LangfuseCallbackHandler())

    # Stream + collect for cache 
    collected: List[str] = []

    async def generate():
        async for chunk in llm.astream(
            final_messages,
            config={"callbacks": callbacks} if callbacks else {},
        ):
            if chunk.content:
                collected.append(chunk.content)
                yield chunk.content
        if r:
            full = "".join(collected)
            await r.set(ck, full, ex=CACHE_TTL)
        _metrics["total_latency_ms"] += (time.time() - t0) * 1000

    return StreamingResponse(generate(), media_type="text/plain")


@app.post("/api/rate")
async def rate_professor(req: RateRequest):
    if not req.professorName.strip():
        raise HTTPException(400, "professorName is required")
    if not req.review.strip():
        raise HTTPException(400, "review is required")
    if not 1 <= req.stars <= 5:
        raise HTTPException(400, "stars must be between 1 and 5")

    score = sia.polarity_scores(req.review)["compound"]
    label = ("positive" if score >= 0.05 else "negative" if score <= -0.05 else "neutral")
    vid   = f"{req.professorName.replace(' ', '_')}_{uuid.uuid4().hex[:8]}"

    index.upsert(
        vectors=[{
            "id": vid,
            "values": embed(req.review),
            "metadata": {
                "professor":        req.professorName,
                "review":           req.review,
                "subject":          req.subject,
                "stars":            req.stars,
                "teaching_style":   req.teachingStyle,
                "difficulty_level": req.difficultyLevel,
                "availability":     req.availability,
                "sentiment_score":  round(score, 4),
                "sentiment_label":  label,
                "submitted_by":     req.userId,
            },
        }],
        namespace=NAMESPACE,
    )

    r = await get_redis()
    if r:
        try:
            keys = await r.keys("rmp:chat:*")
            if keys:
                await r.delete(*keys)
        except Exception:
            pass

    return {"success": True, "vector_id": vid, "sentiment_label": label, "sentiment_score": round(score, 4)}


@app.post("/api/search")
async def search(req: SearchRequest):
    t0 = time.time()

    # ── Cache lookup ──────────────────────────────────────────────────────────
    cache_payload = req.model_dump()
    r = await get_redis()
    ck = cache_key("search", cache_payload)
    if r:
        cached = await r.get(ck)
        if cached:
            _metrics["cache_hits"] += 1
            return json.loads(cached)
        _metrics["cache_misses"] += 1

    query       = req.professorName if req.professorName else req.query
    query_vec   = embed(query)

    filter_params = {
        "teachingStyle":   req.teachingStyle,
        "difficultyLevel": req.difficultyLevel,
        "subject":         req.subject,
        "availability":    req.availability,
        "sentiment":       req.sentiment,
        "excludeBelow":    req.excludeBelow,
    }
    pc_filter = build_filter(filter_params)
    top_k     = 30 if req.sortBy or req.use_rerank else 20

    q_kwargs = {
        "vector": query_vec, "top_k": top_k,
        "namespace": NAMESPACE, "include_metadata": True,
    }
    if pc_filter:
        q_kwargs["filter"] = pc_filter

    results = index.query(**q_kwargs)
    matches = results.get("matches", [])

    if req.professorName:
        name_lower = req.professorName.lower()
        matches    = [m for m in matches if name_lower in m["metadata"].get("professor", "").lower()]

    if req.use_mmr and matches:
        matches = mmr_rerank(query_vec, matches, top_k=15)

    if req.use_rerank and matches:
        matches = crossencoder_rerank(query, matches, top_k=10)

    professors = [
        {
            "id":              m["id"],
            "score":           round(m.get("score", 0), 4),
            "professor":       m["metadata"].get("professor", ""),
            "subject":         m["metadata"].get("subject", ""),
            "stars":           m["metadata"].get("stars", 0),
            "review":          m["metadata"].get("review", ""),
            "teaching_style":  m["metadata"].get("teaching_style", ""),
            "difficulty_level": m["metadata"].get("difficulty_level", ""),
            "availability":    m["metadata"].get("availability", ""),
            "sentiment_label": m["metadata"].get("sentiment_label", ""),
            "sentiment_score": m["metadata"].get("sentiment_score", 0),
        }
        for m in matches
    ]

    if req.sortBy:
        professors = sort_professors(professors, req.sortBy)

    professors = professors[:10]
    latency_ms = round((time.time() - t0) * 1000, 1)
    response   = {"professors": professors, "count": len(professors), "latency_ms": latency_ms}

    if r:
        await r.set(ck, json.dumps(response), ex=CACHE_TTL)

    return response

@app.post("/api/eval")
async def evaluate(req: EvalRequest):
    """
    Offline evaluation endpoint.
    Computes MRR, Hit@K, Context Precision, and Answer Relevance
    for each item in the eval set.
    """
    results = []

    for item in req.eval_set:
        query        = item["query"]
        relevant_ids = item.get("relevant_ids", [])
        q_vec        = embed(query)

        raw = index.query(
            vector=q_vec, top_k=req.top_k * 3,
            namespace=NAMESPACE, include_metadata=True,
        ).get("matches", [])

        mmr_res    = mmr_rerank(q_vec, raw, top_k=req.top_k * 2)
        ranked     = crossencoder_rerank(query, mmr_res, top_k=req.top_k)

        ranked_with_ids = [{"id": m["id"], "metadata": m["metadata"]} for m in ranked]

        mrr        = compute_mrr(ranked_with_ids, relevant_ids)
        hit_k      = compute_hit_at_k(ranked_with_ids, relevant_ids, k=req.top_k)
        ctx_prec   = compute_context_precision(ranked_with_ids, query)

        ctx_text   = format_context(ranked[:3])
        lc_msgs    = prompt.format_messages(context=ctx_text, question=query)
        answer_chunks: List[str] = []
        async for chunk in llm.astream(lc_msgs):
            if chunk.content:
                answer_chunks.append(chunk.content)
        answer      = "".join(answer_chunks)
        ans_rel     = compute_answer_relevance(answer, query)

        result = {
            "query":             query,
            "mrr":               round(mrr, 4),
            f"hit_at_{req.top_k}": round(hit_k, 4),
            "context_precision": round(ctx_prec, 4),
            "answer_relevance":  round(ans_rel, 4),
            "top_result":        ranked[0]["metadata"].get("professor") if ranked else None,
        }
        results.append(result)
        _metrics["eval_runs"].append(result)

    avg = lambda key: round(sum(r[key] for r in results) / len(results), 4) if results else 0.0

    return {
        "eval_count":         len(results),
        "avg_mrr":            avg("mrr"),
        f"avg_hit_at_{req.top_k}": avg(f"hit_at_{req.top_k}"),
        "avg_context_precision": avg("context_precision"),
        "avg_answer_relevance":  avg("answer_relevance"),
        "results":            results,
    }

@app.get("/api/metrics")
async def metrics():
    """Live system metrics for the dashboard."""
    n = _metrics["total_queries"] or 1
    cache_total = _metrics["cache_hits"] + _metrics["cache_misses"]
    stats = index.describe_index_stats()
    return {
        "total_queries":        _metrics["total_queries"],
        "avg_latency_ms":       round(_metrics["total_latency_ms"] / n, 1),
        "cache_hit_rate":       round(_metrics["cache_hits"] / max(cache_total, 1), 3),
        "cache_hits":           _metrics["cache_hits"],
        "cache_misses":         _metrics["cache_misses"],
        "rerank_calls":         _metrics["rerank_calls"],
        "avg_rerank_gain_rate": round(_metrics["avg_rerank_gain"], 3),
        "total_vectors":        stats.get("total_vector_count", 0),
        "recent_evals":         _metrics["eval_runs"][-5:],
        "components": {
            "redis":         REDIS_ENABLED and redis_client is not None,
            "langfuse":      LANGFUSE_ENABLED,
            "mmr":           True,
            "cross_encoder": True,
        },
    }

@app.get("/api/health")
async def health():
    stats = index.describe_index_stats()
    r = await get_redis()
    return {
        "status":        "ok",
        "version":       "3.0.0",
        "total_vectors": stats.get("total_vector_count", 0),
        "redis":         r is not None,
        "langfuse":      LANGFUSE_ENABLED,
        "framework":     "FastAPI + LangChain + MMR + CrossEncoder + Redis",
    }

if __name__ == "__main__":
    uvicorn.run("setup_rag:app", host="0.0.0.0", port=8080, reload=False)