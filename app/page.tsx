"use client";
import React from "react";
import {
  Box, Button, Stack, TextField, MenuItem, Select,
  InputLabel, FormControl, Typography, IconButton,
  Chip, Alert, Snackbar, Tooltip, Divider,
} from "@mui/material";
import { useState, useRef, useEffect } from "react";
import StarsCanvas from "../components/starbg";
import styles from "../styles/Home.module.css";
import DeleteIcon from "@mui/icons-material/Delete";
import SendIcon from "@mui/icons-material/Send";
import SearchIcon from "@mui/icons-material/Search";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import CompareArrowsIcon from "@mui/icons-material/CompareArrows";
import CloseIcon from "@mui/icons-material/Close";
import TuneIcon from "@mui/icons-material/Tune";
import PersonIcon from "@mui/icons-material/Person";
import SortIcon from "@mui/icons-material/Sort";
import Navbar from "./navbar";
import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";

type Message = { role: "user" | "assistant"; content: string };

type SearchOptions = {
  professorName: string;
  subject: string;
  teachingStyle: string;
  difficultyLevel: string;
  availability: string;
  sentiment: string;       
  sortBy: string;          
  excludeBelow: string;    
};

type RatingOptions = {
  professorName: string; subject: string; teachingStyle: string;
  difficultyLevel: string; availability: string; rating: string; review: string;
};

type ProfessorCard = {
  id: string; professor: string; subject: string; stars: number;
  review: string; teaching_style: string; difficulty_level: string;
  availability: string; sentiment_label: string; score: number;
};

const FLASK_URL = process.env.NEXT_PUBLIC_API_URL!;

const C = {
  bg: "#080b14",
  surface: "rgba(255,255,255,0.04)",
  surfaceHover: "rgba(255,255,255,0.07)",
  border: "rgba(255,255,255,0.08)",
  borderHover: "rgba(139,92,246,0.5)",
  accent: "#8b5cf6",
  accentDim: "rgba(139,92,246,0.15)",
  accentGlow: "0 0 20px rgba(139,92,246,0.3)",
  text: "#f1f5f9",
  textMuted: "#94a3b8",
  userBubble: "linear-gradient(135deg, #7c3aed, #4f46e5)",
  aiBubble: "rgba(255,255,255,0.05)",
  positive: "#10b981",
  neutral: "#f59e0b",
  negative: "#ef4444",
  gold: "#f59e0b",
};

const scrollbarSx = {
  overflowY: "auto" as const,
  "&::-webkit-scrollbar": { width: "4px" },
  "&::-webkit-scrollbar-track": { background: "transparent" },
  "&::-webkit-scrollbar-thumb": { background: "rgba(139,92,246,0.3)", borderRadius: "4px" },
};

const panelSx = {
  width: "300px", minWidth: "300px",
  bgcolor: "rgba(255,255,255,0.03)",
  border: `1px solid ${C.border}`,
  borderRadius: "16px",
  backdropFilter: "blur(20px)",
  p: 2.5,
  ...scrollbarSx,
};

const inputSx = {
  "& .MuiOutlinedInput-root": {
    bgcolor: "rgba(255,255,255,0.05)", borderRadius: "8px",
    color: C.text, fontSize: "0.85rem",
    "& fieldset": { borderColor: C.border },
    "&:hover fieldset": { borderColor: C.borderHover },
    "&.Mui-focused fieldset": { borderColor: C.accent },
  },
  "& .MuiInputLabel-root": { color: C.textMuted, fontSize: "0.85rem" },
  "& .MuiInputLabel-root.Mui-focused": { color: C.accent },
  "& .MuiSelect-icon": { color: C.textMuted },
};

// ── Sub-components ────────────────────────────────────────────────────────────
function StarRating({ stars, max = 5 }: { stars: number; max?: number }) {
  return (
    <Stack direction="row" spacing={0.2} alignItems="center">
      {Array.from({ length: max }).map((_, i) =>
        i < stars
          ? <StarIcon key={i} sx={{ fontSize: 14, color: C.gold }} />
          : <StarBorderIcon key={i} sx={{ fontSize: 14, color: C.textMuted }} />
      )}
      <Typography variant="caption" sx={{ color: C.textMuted, ml: 0.5 }}>{stars}/{max}</Typography>
    </Stack>
  );
}

function SentimentBadge({ label }: { label: string }) {
  const color = label === "positive" ? C.positive : label === "negative" ? C.negative : C.neutral;
  const emoji = label === "positive" ? "😊" : label === "negative" ? "😕" : "😐";
  return (
    <Chip label={`${emoji} ${label}`} size="small" sx={{
      bgcolor: `${color}22`, color, border: `1px solid ${color}44`,
      fontSize: "10px", height: 20, fontWeight: 600, textTransform: "capitalize",
    }} />
  );
}

function DifficultyBadge({ level }: { level: string }) {
  const color = level === "Easy" ? C.positive : level === "Difficult" ? C.negative : C.neutral;
  return (
    <Chip label={level} size="small" sx={{
      bgcolor: `${color}22`, color, border: `1px solid ${color}44`, fontSize: "10px", height: 20,
    }} />
  );
}

function ProfCard({ prof, isSelected, onCompare, compareCount }: {
  prof: ProfessorCard; isSelected: boolean;
  onCompare: (p: ProfessorCard) => void; compareCount: number;
}) {
  return (
    <Box sx={{
      bgcolor: isSelected ? "rgba(139,92,246,0.12)" : C.surface,
      border: `1px solid ${isSelected ? C.accent : C.border}`,
      borderRadius: "12px", p: 2, transition: "all 0.2s",
      "&:hover": { bgcolor: C.surfaceHover, border: `1px solid ${C.borderHover}`, transform: "translateY(-1px)", boxShadow: C.accentGlow },
    }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" mb={1}>
        <Box>
          <Typography sx={{ color: C.text, fontWeight: 700, fontSize: "0.9rem" }}>{prof.professor}</Typography>
          <Typography sx={{ color: C.accent, fontSize: "0.75rem", fontWeight: 500 }}>{prof.subject}</Typography>
        </Box>
        <Tooltip title={isSelected ? "Remove from compare" : compareCount >= 2 ? "Max 2 professors" : "Add to compare"}>
          <span>
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); onCompare(prof); }}
              disabled={!isSelected && compareCount >= 2}
              sx={{ bgcolor: isSelected ? C.accentDim : "transparent", color: isSelected ? C.accent : C.textMuted, "&:hover": { bgcolor: C.accentDim, color: C.accent }, width: 28, height: 28 }}>
              <CompareArrowsIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      <StarRating stars={prof.stars} />
      <Stack direction="row" spacing={0.5} mt={1} flexWrap="wrap" gap={0.5}>
        {prof.teaching_style && (
          <Chip label={prof.teaching_style} size="small" sx={{
            bgcolor: "rgba(139,92,246,0.15)", color: "#a78bfa",
            border: "1px solid rgba(139,92,246,0.3)", fontSize: "10px", height: 20,
          }} />
        )}
        {prof.difficulty_level && <DifficultyBadge level={prof.difficulty_level} />}
        {prof.sentiment_label && <SentimentBadge label={prof.sentiment_label} />}
      </Stack>
      <Typography sx={{
        color: C.textMuted, fontSize: "0.75rem", mt: 1.5, fontStyle: "italic",
        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: 1.5,
      }}>
        &quot;{prof.review}&quot;
      </Typography>
    </Box>
  );
}

function ComparePanel({ profs, onClose }: { profs: ProfessorCard[]; onClose: () => void }) {
  if (profs.length < 2) return null;
  const [a, b] = profs;
  const rows = [
    { label: "Subject", va: a.subject, vb: b.subject },
    { label: "Stars", va: `${a.stars}/5`, vb: `${b.stars}/5`, winner: a.stars > b.stars ? "a" : b.stars > a.stars ? "b" : null },
    { label: "Teaching Style", va: a.teaching_style || "—", vb: b.teaching_style || "—" },
    { label: "Difficulty", va: a.difficulty_level || "—", vb: b.difficulty_level || "—" },
    { label: "Availability", va: a.availability || "—", vb: b.availability || "—" },
    { label: "Sentiment", va: a.sentiment_label || "—", vb: b.sentiment_label || "—", winner: a.sentiment_label === "positive" && b.sentiment_label !== "positive" ? "a" : b.sentiment_label === "positive" && a.sentiment_label !== "positive" ? "b" : null },
  ];
  return (
    <Box sx={{
      bgcolor: C.surface, border: `1px solid ${C.border}`, borderRadius: "16px", p: 2.5, mb: 2,
      background: "linear-gradient(135deg, rgba(139,92,246,0.08), rgba(79,70,229,0.05))",
    }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
        <Stack direction="row" alignItems="center" gap={1}>
          <CompareArrowsIcon sx={{ color: C.accent, fontSize: 18 }} />
          <Typography sx={{ color: C.text, fontWeight: 700, fontSize: "0.9rem" }}>Compare Professors</Typography>
        </Stack>
        <IconButton size="small" onClick={onClose} sx={{ color: C.textMuted }}>
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Stack>
      <Stack direction="row" mb={1.5}>
        <Box sx={{ flex: 1 }} />
        {[a, b].map((p, i) => (
          <Box key={i} sx={{ flex: 1, textAlign: "center" }}>
            <Typography sx={{ color: C.accent, fontWeight: 700, fontSize: "0.8rem" }}>{p.professor}</Typography>
          </Box>
        ))}
      </Stack>
      <Divider sx={{ borderColor: C.border, mb: 1.5 }} />
      {rows.map((row, i) => (
        <Stack key={i} direction="row" alignItems="center" py={0.8}
          sx={{ borderBottom: i < rows.length - 1 ? `1px solid ${C.border}` : "none" }}>
          <Typography sx={{ flex: 1, color: C.textMuted, fontSize: "0.75rem", fontWeight: 500 }}>{row.label}</Typography>
          {[{ val: row.va, side: "a" }, { val: row.vb, side: "b" }].map(({ val, side }) => (
            <Box key={side} sx={{ flex: 1, textAlign: "center" }}>
              <Typography sx={{ fontSize: "0.8rem", color: row.winner === side ? C.positive : C.text, fontWeight: row.winner === side ? 700 : 400 }}>
                {val} {row.winner === side && "✓"}
              </Typography>
            </Box>
          ))}
        </Stack>
      ))}
    </Box>
  );
}

function TypingIndicator() {
  return (
    <Box sx={{ display: "flex", justifyContent: "flex-start" }}>
      <Box sx={{ bgcolor: C.aiBubble, border: `1px solid ${C.border}`, borderRadius: "16px 16px 16px 4px", p: "12px 16px", display: "flex", gap: "5px", alignItems: "center" }}>
        {[0, 1, 2].map((i) => (
          <Box key={i} sx={{
            width: 7, height: 7, borderRadius: "50%", bgcolor: C.accent,
            animation: "bounce 1.2s infinite", animationDelay: `${i * 0.2}s`,
            "@keyframes bounce": { "0%, 80%, 100%": { transform: "translateY(0)", opacity: 0.3 }, "40%": { transform: "translateY(-5px)", opacity: 1 } },
          }} />
        ))}
      </Box>
    </Box>
  );
}

function SimpleMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];
  const renderInline = (line: string, key: number) =>
    line.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
      p.startsWith("**") && p.endsWith("**") ? <strong key={i} style={{ color: "#e2e8f0" }}>{p.slice(2, -2)}</strong> : p
    );
  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(<ul key={`ul-${elements.length}`} style={{ paddingLeft: 18, margin: "4px 0" }}>{listItems}</ul>);
      listItems = [];
    }
  };
  lines.forEach((line, i) => {
    const isBullet = line.startsWith("- ") || line.startsWith("• ");
    if (isBullet) {
      listItems.push(<li key={i} style={{ marginBottom: 3, fontSize: "0.875rem", color: "#cbd5e1" }}>{renderInline(line.replace(/^[-•]\s/, ""), i)}</li>);
    } else {
      flushList();
      if (line.trim() === "") { elements.push(<br key={i} />); }
      else { elements.push(<span key={i} style={{ display: "block", marginBottom: 3, fontSize: "0.875rem", color: "#cbd5e1", lineHeight: 1.6 }}>{renderInline(line, i)}</span>); }
    }
  });
  flushList();
  return <>{elements}</>;
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  return (
    <Box sx={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}>
      {!isUser && (
        <Box sx={{ width: 28, height: 28, borderRadius: "50%", bgcolor: C.accentDim, border: `1px solid ${C.borderHover}`, display: "flex", alignItems: "center", justifyContent: "center", mr: 1, flexShrink: 0, mt: 0.5 }}>
          <StarIcon sx={{ fontSize: 14, color: C.accent }} />
        </Box>
      )}
      <Box sx={{
        maxWidth: "78%", background: isUser ? C.userBubble : C.aiBubble,
        border: `1px solid ${isUser ? "transparent" : C.border}`, color: C.text,
        borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
        p: "10px 14px", wordWrap: "break-word",
        boxShadow: isUser ? "0 4px 15px rgba(124,58,237,0.3)" : "none",
      }}>
        {isUser ? <Typography variant="body2" sx={{ color: "#fff", fontSize: "0.875rem" }}>{msg.content}</Typography> : <SimpleMarkdown text={msg.content} />}
      </Box>
    </Box>
  );
}

function Dashboard({ results }: { results: ProfessorCard[] }) {
  const total = results.length;
  const avgRating = total
    ? (results.reduce((acc, r) => acc + r.stars, 0) / total).toFixed(1)
    : "0";

  const sentimentCount = {
    positive: results.filter((r) => r.sentiment_label === "positive").length,
    neutral: results.filter((r) => r.sentiment_label === "neutral").length,
    negative: results.filter((r) => r.sentiment_label === "negative").length,
  };

  return (
    <Box
      sx={{
        mb: 2,
        p: 2,
        borderRadius: "16px",
        border: `1px solid rgba(255,255,255,0.08)`,
        background: "linear-gradient(135deg, rgba(139,92,246,0.1), rgba(79,70,229,0.05))",
      }}
    >
      <Typography sx={{ color: "#fff", fontWeight: 700, mb: 1 }}>
        📊 Dashboard Insights
      </Typography>

      <Stack direction="row" spacing={2}>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ color: "#94a3b8", fontSize: "0.75rem" }}>
            Total Professors
          </Typography>
          <Typography sx={{ color: "#fff", fontSize: "1.2rem", fontWeight: 700 }}>
            {total}
          </Typography>
        </Box>

        <Box sx={{ flex: 1 }}>
          <Typography sx={{ color: "#94a3b8", fontSize: "0.75rem" }}>
            Avg Rating
          </Typography>
          <Typography sx={{ color: "#f59e0b", fontSize: "1.2rem", fontWeight: 700 }}>
            ⭐ {avgRating}
          </Typography>
        </Box>

        <Box sx={{ flex: 1 }}>
          <Typography sx={{ color: "#94a3b8", fontSize: "0.75rem" }}>
            😊 Positive
          </Typography>
          <Typography sx={{ color: "#10b981", fontSize: "1.2rem", fontWeight: 700 }}>
            {sentimentCount.positive}
          </Typography>
        </Box>

        <Box sx={{ flex: 1 }}>
          <Typography sx={{ color: "#94a3b8", fontSize: "0.75rem" }}>
            😕 Negative
          </Typography>
          <Typography sx={{ color: "#ef4444", fontSize: "1.2rem", fontWeight: 700 }}>
            {sentimentCount.negative}
          </Typography>
        </Box>
      </Stack>
    </Box>
  );
}

// MAIN
export default function Home() {
  const { user } = useUser();
  const router = useRouter();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [messages, setMessages] = useState<Message[]>([{
    role: "assistant",
    content: "Hi! I'm the **Rate My Professor AI Assistant**.\n\nI can help you:\n- 🔍 Find professors by subject, teaching style, or difficulty\n- ⭐ Compare professor ratings side by side\n- 😊 Filter by review sentiment\n- 📊 Sort results by rating\n\nHow can I help you today?",
  }]);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<ProfessorCard[]>([]);
  const [compareList, setCompareList] = useState<ProfessorCard[]>([]);
  const [showCompare, setShowCompare] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: "success" | "error" }>({ open: false, message: "", severity: "success" });

  const [searchOptions, setSearchOptions] = useState<SearchOptions>({
    professorName: "", subject: "", teachingStyle: "",
    difficultyLevel: "", availability: "",
    sentiment: "",      
    sortBy: "",         
    excludeBelow: "",   
  });

  const [ratingOptions, setRatingOptions] = useState<RatingOptions>({
    professorName: "", subject: "", teachingStyle: "",
    difficultyLevel: "", availability: "", rating: "", review: "",
  });

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, isLoading]);

  const activeFilterCount = Object.values(searchOptions).filter(Boolean).length;

  const handleSearch = async () => {
    const hasFilters = Object.values(searchOptions).some((v) => v);
    if (!hasFilters) return;

    setIsSearching(true);
    setSearchResults([]);

    // human-readable summary for chat
    const labelMap: Record<string, string> = {
      professorName: "Professor", subject: "Subject", teachingStyle: "Teaching Style",
      difficultyLevel: "Difficulty", availability: "Availability",
      sentiment: "Sentiment", sortBy: "Sort", excludeBelow: "Min Stars",
    };
    const sortLabels: Record<string, string> = { highest_rated: "Highest Rated", lowest_rated: "Lowest Rated" };

    const filterSummary = Object.entries(searchOptions)
      .filter(([, v]) => v)
      .map(([k, v]) => `${labelMap[k] || k}: **${k === "sortBy" ? sortLabels[v] || v : v}**`)
      .join(", ");

    const finalMessage = `Find professors — ${filterSummary}`;
    setMessages((prev) => [...prev, { role: "user", content: finalMessage }]);
    setIsLoading(true);

    const searchPayload = {
      query: finalMessage,
      professorName: searchOptions.professorName,
      subject: searchOptions.subject,
      teachingStyle: searchOptions.teachingStyle,
      difficultyLevel: searchOptions.difficultyLevel,
      availability: searchOptions.availability,
      sentiment: searchOptions.sentiment,
      sortBy: searchOptions.sortBy,
      excludeBelow: searchOptions.excludeBelow ? parseInt(searchOptions.excludeBelow) : null,
    };

    // Chat filters 
    const chatFilters = {
      teachingStyle: searchOptions.teachingStyle,
      difficultyLevel: searchOptions.difficultyLevel,
      subject: searchOptions.subject,
      availability: searchOptions.availability,
      sentiment: searchOptions.sentiment,
      sortBy: searchOptions.sortBy,
    };

    try {
      const [chatRes, searchRes] = await Promise.all([
        fetch(`${FLASK_URL}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [{ role: "user", content: finalMessage }], filters: chatFilters }),
        }),
        fetch(`${FLASK_URL}/api/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(searchPayload),
        }),
      ]);

      if (searchRes.ok) {
        const searchData = await searchRes.json();
        setSearchResults(searchData.professors || []);
      }

      if (chatRes.ok) {
        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
        setIsLoading(false);
        const reader = chatRes.body!.getReader();
        const decoder = new TextDecoder();
        const process = async ({ done, value }: ReadableStreamReadResult<Uint8Array>): Promise<void> => {
          if (done) return;
          const text = decoder.decode(value || new Uint8Array(), { stream: true });
          setMessages((prev) => { const last = prev[prev.length - 1]; return [...prev.slice(0, -1), { ...last, content: last.content + text }]; });
          return reader.read().then(process);
        };
        await reader.read().then(process);
      } else {
        setIsLoading(false);
      }
    } catch {
      setIsLoading(false);
      setMessages((prev) => [...prev, { role: "assistant", content: "Sorry, I couldn't connect to the server." }]);
    } finally {
      setIsSearching(false);
    }
  };

  const sendMessage = async () => {
  if (!message.trim()) return;

  const finalMessage = message.trim();
  setMessage("");
  setIsLoading(true);
  const updatedMessages = [...messages, { role: "user", content: finalMessage }];
  setMessages(updatedMessages);

  try {
    const response = await fetch(`${FLASK_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: updatedMessages,
        filters: {},
      }),
    });

    if (!response.ok) throw new Error(`${response.status}`);
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
    setIsLoading(false);

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    const process = async ({ done, value }: ReadableStreamReadResult<Uint8Array>): Promise<void> => {
      if (done) return;
      const text = decoder.decode(value || new Uint8Array(), { stream: true });
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        return [
          ...prev.slice(0, -1),
          { ...last, content: last.content + text },
        ];
      });
      return reader.read().then(process);
    };
    await reader.read().then(process);
  } catch {
    setIsLoading(false);
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: "Sorry, I couldn't connect to the server." },
    ]);
  }
};

  const submitRating = async () => {
    const { professorName, review, rating } = ratingOptions;
    if (!professorName.trim()) { setSnackbar({ open: true, message: "Please enter the professor's name.", severity: "error" }); return; }
    if (!review.trim()) { setSnackbar({ open: true, message: "Please write a review.", severity: "error" }); return; }
    if (!rating || Number(rating) < 1 || Number(rating) > 5) { setSnackbar({ open: true, message: "Please enter a rating between 1 and 5.", severity: "error" }); return; }
    setIsSubmitting(true);
    try {
      const response = await fetch(`${FLASK_URL}/api/rate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ professorName: ratingOptions.professorName, subject: ratingOptions.subject, teachingStyle: ratingOptions.teachingStyle, difficultyLevel: ratingOptions.difficultyLevel, availability: ratingOptions.availability, stars: Number(ratingOptions.rating), review: ratingOptions.review, userId: user?.id || "anonymous" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Submission failed");
      const sentimentEmoji = data.sentiment_label === "positive" ? "😊" : data.sentiment_label === "negative" ? "😕" : "😐";
      setMessages((prev) => [...prev, { role: "assistant", content: `✅ Rating for **${professorName}** submitted!\n\nSentiment: ${sentimentEmoji} **${data.sentiment_label}** (score: ${data.sentiment_score})\n\nThe review is now searchable in the database.` }]);
      setSnackbar({ open: true, message: "Rating submitted successfully!", severity: "success" });
      setRatingOptions({ professorName: "", subject: "", teachingStyle: "", difficultyLevel: "", availability: "", rating: "", review: "" });
    } catch (error: any) {
      setSnackbar({ open: true, message: error.message || "Failed to submit rating.", severity: "error" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCompare = (prof: ProfessorCard) => {
    setCompareList((prev) => {
      const exists = prev.find((p) => p.id === prof.id);
      if (exists) return prev.filter((p) => p.id !== prof.id);
      if (prev.length >= 2) return prev;
      const next = [...prev, prof];
      if (next.length === 2) setShowCompare(true);
      return next;
    });
  };

  const handleSearchChange = (e: any) => {
    const { name, value } = e.target;
    setSearchOptions((prev) => ({ ...prev, [name]: value }));
  };
  const handleRatingChange = (e: any) => {
    const { name, value } = e.target;
    setRatingOptions((prev) => ({ ...prev, [name]: value }));
  };

  const SearchSelect = ({ name, label, options }: { name: string; label: string; options: { value: string; label: string }[] }) => (
    <FormControl fullWidth size="small" sx={{ mb: 1.5, ...inputSx }}>
      <InputLabel>{label}</InputLabel>
      <Select name={name} value={(searchOptions as any)[name]} onChange={handleSearchChange} label={label}
        MenuProps={{ PaperProps: { sx: { bgcolor: "#1e1b4b", color: C.text } } }}>
        <MenuItem value="">Any</MenuItem>
        {options.map((o) => <MenuItem key={o.value} value={o.value} sx={{ fontSize: "0.85rem" }}>{o.label}</MenuItem>)}
      </Select>
    </FormControl>
  );

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: C.bg, position: "relative" }}>
      <Box sx={{ position: "fixed", inset: 0, zIndex: 0 }}><StarsCanvas /></Box>
      <Navbar />

      <Box sx={{ position: "relative", zIndex: 1, pt: "182px", pb: 3, minHeight: "100vh" }}>
        {!user ? (
          <Box sx={{ textAlign: "center", px: 2, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "calc(100vh - 182px)" }}>
            <Typography variant="h4" fontWeight="bold" className={styles.glowingText} sx={{ color: "#fff" }}>
              Welcome to Rate My Professor AI Assistant
            </Typography>
            <Typography variant="body1" mt={2} className={styles.glowingParagraph} sx={{ color: "#94a3b8" }}>
              Discover insights on professors, from teaching styles to course difficulty, all in one place.
            </Typography>
            <Button variant="contained"
              sx={{ mt: 4, background: "linear-gradient(135deg, #7c3aed, #4f46e5)", color: "#fff", borderRadius: "10px", px: 4, py: 1.5 }}
              onClick={() => router.push("/sign-in")}>
              Get Started
            </Button>
          </Box>
        ) : (
          <Box sx={{ px: 2, maxWidth: "1600px", margin: "0 auto" }}>
            <Stack direction="row" spacing={2} sx={{ height: "calc(100vh - 200px)" }}>

              {/* Search Panel */}
              <Box sx={{ ...panelSx, display: "flex", flexDirection: "column", gap: 0 }}>
                <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2}>
                  <Stack direction="row" alignItems="center" gap={1}>
                    <TuneIcon sx={{ color: C.accent, fontSize: 18 }} />
                    <Typography sx={{ color: C.text, fontWeight: 700, fontSize: "0.95rem" }}>Search</Typography>
                  </Stack>
                  {activeFilterCount > 0 && (
                    <Chip label={`${activeFilterCount}`} size="small"
                      sx={{ bgcolor: C.accentDim, color: C.accent, border: `1px solid ${C.borderHover}`, fontSize: "11px", height: 20 }} />
                  )}
                </Stack>

                <TextField label="Professor Name" name="professorName" value={searchOptions.professorName}
                  onChange={handleSearchChange} fullWidth size="small" sx={{ mb: 1.5, ...inputSx }}
                  placeholder="e.g. Dr. Smith"
                  InputProps={{ startAdornment: <PersonIcon sx={{ color: C.textMuted, fontSize: 16, mr: 0.5 }} /> }} />

                <TextField label="Subject" name="subject" value={searchOptions.subject}
                  onChange={handleSearchChange} fullWidth size="small" sx={{ mb: 1.5, ...inputSx }}
                  placeholder="e.g. Mathematics" />

                <SearchSelect name="teachingStyle" label="Teaching Style" options={[
                  { value: "Hands-on", label: "Hands-on" },
                  { value: "Lecture-based", label: "Lecture-based" },
                  { value: "Project-based", label: "Project-based" },
                  { value: "Discussion-oriented", label: "Discussion-oriented" },
                ]} />

                <SearchSelect name="difficultyLevel" label="Difficulty" options={[
                  { value: "Easy", label: "🟢 Easy" },
                  { value: "Moderate", label: "🟡 Moderate" },
                  { value: "Difficult", label: "🔴 Difficult" },
                ]} />

                <SearchSelect name="availability" label="Availability" options={[
                  { value: "Available", label: "Available" },
                  { value: "Somewhat Available", label: "Somewhat Available" },
                  { value: "Limited", label: "Limited" },
                ]} />

                <Stack direction="row" alignItems="center" gap={1} mb={1.5}>
                  <Divider sx={{ flex: 1, borderColor: C.border }} />
                  <Typography sx={{ color: C.textMuted, fontSize: "0.7rem", whiteSpace: "nowrap" }}>ADVANCED</Typography>
                  <Divider sx={{ flex: 1, borderColor: C.border }} />
                </Stack>

                {/* Sentiment filter */}
                <SearchSelect name="sentiment" label="😊 Review Sentiment" options={[
                  { value: "positive", label: "😊 Positive" },
                  { value: "neutral", label: "😐 Neutral" },
                  { value: "negative", label: "😕 Negative" },
                ]} />

                {/* Sort by rating */}
                <SearchSelect name="sortBy" label="⬆ Sort By Rating" options={[
                  { value: "highest_rated", label: "⭐ Highest Rated First" },
                  { value: "lowest_rated", label: "☆ Lowest Rated First" },
                ]} />

                {/* Exclude below */}
                <SearchSelect name="excludeBelow" label="🚫 Exclude Below Stars" options={[
                  { value: "2", label: "Exclude 1★ only" },
                  { value: "3", label: "Exclude below 3★" },
                  { value: "4", label: "Exclude below 4★" },
                  { value: "5", label: "5★ only" },
                ]} />

                {activeFilterCount > 0 && (
                  <Button variant="text" size="small" fullWidth
                    sx={{ mb: 1, color: C.textMuted, fontSize: "0.75rem", "&:hover": { color: C.text } }}
                    onClick={() => { setSearchOptions({ professorName: "", subject: "", teachingStyle: "", difficultyLevel: "", availability: "", sentiment: "", sortBy: "", excludeBelow: "" }); setSearchResults([]); }}>
                    Clear all filters
                  </Button>
                )}

                <Button variant="contained" fullWidth startIcon={<SearchIcon />}
                  onClick={handleSearch} disabled={isSearching || activeFilterCount === 0}
                  sx={{
                    background: "linear-gradient(135deg, #7c3aed, #4f46e5)", color: "#fff",
                    py: 1.2, borderRadius: "8px", fontWeight: 600, mb: 2,
                    "&:hover": { background: "linear-gradient(135deg, #6d28d9, #4338ca)" },
                    "&:disabled": { opacity: 0.5 },
                  }}>
                  {isSearching ? "Searching…" : "SEARCH"}
                </Button>

                {/* Results */}
                {searchResults.length > 0 && (
                  <Box sx={{ flex: 1, ...scrollbarSx }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1.5}>
                      <Typography sx={{ color: C.textMuted, fontSize: "0.75rem" }}>
                        {searchResults.length} result{searchResults.length !== 1 ? "s" : ""}
                        {searchOptions.sortBy && (
                          <Chip label={searchOptions.sortBy === "highest_rated" ? "⭐ High→Low" : "☆ Low→High"}
                            size="small" sx={{ ml: 1, bgcolor: C.accentDim, color: C.accent, border: `1px solid ${C.borderHover}`, fontSize: "9px", height: 16 }} />
                        )}
                      </Typography>
                      {compareList.length > 0 && (
                        <Chip label={`${compareList.length} selected`} size="small"
                          icon={<CompareArrowsIcon sx={{ fontSize: "12px !important" }} />}
                          onClick={() => compareList.length === 2 && setShowCompare(true)}
                          sx={{ bgcolor: C.accentDim, color: C.accent, border: `1px solid ${C.borderHover}`, fontSize: "10px", height: 20, cursor: "pointer" }} />
                      )}
                    </Stack>
                    <Stack spacing={1.5}>
                      {searchResults.map((prof) => (
                        <ProfCard key={prof.id} prof={prof}
                          isSelected={compareList.some((p) => p.id === prof.id)}
                          onCompare={handleCompare} compareCount={compareList.length} />
                      ))}
                    </Stack>
                  </Box>
                )}

                {searchResults.length === 0 && activeFilterCount > 0 && !isSearching && (
                  <Box sx={{ textAlign: "center", py: 3 }}>
                    <Typography sx={{ color: C.textMuted, fontSize: "0.8rem" }}>Click Search to find professors</Typography>
                  </Box>
                )}
              </Box>

              {/* Chat Panel */}
              <Box sx={{ flex: 1, bgcolor: "rgba(255,255,255,0.02)", border: `1px solid ${C.border}`, borderRadius: "16px", backdropFilter: "blur(20px)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
                <Box sx={{ flex: 1, p: 3, display: "flex", flexDirection: "column", gap: 2, ...scrollbarSx }}>
                  {showCompare && compareList.length === 2 ? (
                    <ComparePanel
                      profs={compareList}
                      onClose={() => {
                        setShowCompare(false);
                        setCompareList([]);
                      }}
                    />
                  ) : (
                    <>
                      {searchResults.length > 0 && (
                        <Dashboard results={searchResults} />
                      )}
                    </>
                  )}
                  {messages.map((msg, i) => <MessageBubble key={i} msg={msg} />)}
                  {isLoading && <TypingIndicator />}
                  <div ref={messagesEndRef} />
                </Box>
                <Box sx={{ p: 2, borderTop: `1px solid ${C.border}`, bgcolor: "rgba(0,0,0,0.2)", borderBottomLeftRadius: "16px", borderBottomRightRadius: "16px" }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <TextField fullWidth size="small" value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                      placeholder="Ask about a professor, subject, or teaching style…"
                      disabled={isLoading}
                      sx={{ ...inputSx, "& .MuiOutlinedInput-root": { bgcolor: "rgba(255,255,255,0.05)", borderRadius: "24px", color: C.text, fontSize: "0.875rem", "& fieldset": { borderColor: C.border }, "&:hover fieldset": { borderColor: C.borderHover }, "&.Mui-focused fieldset": { borderColor: C.accent } } }} />
                    <Button variant="contained" onClick={sendMessage} disabled={isLoading} endIcon={<SendIcon />}
                      sx={{ background: "linear-gradient(135deg, #7c3aed, #4f46e5)", minWidth: "90px", borderRadius: "24px", height: "40px" }}>
                      Send
                    </Button>
                    <IconButton onClick={() => setMessages([{ role: "assistant", content: "Hi! I'm the **Rate My Professor AI Assistant**.\n\nI can help you:\n- 🔍 Find professors by subject, teaching style, or difficulty\n- ⭐ Compare professor ratings side by side\n- 😊 Filter by review sentiment\n- 📊 Sort results by rating\n\nHow can I help you today?" }])}
                      sx={{ color: "#ef4444", "&:hover": { bgcolor: "rgba(239,68,68,0.1)" } }}>
                      <DeleteIcon />
                    </IconButton>
                  </Stack>
                </Box>
              </Box>

              {/* Rating Panel */}
              <Box sx={panelSx}>
                <Stack direction="row" alignItems="center" gap={1} mb={2}>
                  <StarIcon sx={{ color: C.gold, fontSize: 18 }} />
                  <Typography sx={{ color: C.text, fontWeight: 700, fontSize: "0.95rem" }}>Rate a Professor</Typography>
                </Stack>

                {[{ label: "Professor Name *", name: "professorName", placeholder: "Dr. Smith" }, { label: "Subject", name: "subject", placeholder: "e.g. Mathematics" }].map(({ label, name, placeholder }) => (
                  <TextField key={name} label={label} name={name} value={(ratingOptions as any)[name]}
                    onChange={handleRatingChange} fullWidth size="small" sx={{ mb: 1.5, ...inputSx }} placeholder={placeholder} />
                ))}

                {[
                  { name: "teachingStyle", label: "Teaching Style", options: ["Hands-on", "Lecture-based", "Project-based", "Discussion-oriented"] },
                  { name: "difficultyLevel", label: "Difficulty Level", options: ["Easy", "Moderate", "Difficult"] },
                  { name: "availability", label: "Availability", options: ["Available", "Somewhat Available", "Limited"] },
                ].map(({ name, label, options }) => (
                  <FormControl key={name} fullWidth size="small" sx={{ mb: 1.5, ...inputSx }}>
                    <InputLabel>{label}</InputLabel>
                    <Select name={name} value={(ratingOptions as any)[name]} onChange={handleRatingChange} label={label}
                      MenuProps={{ PaperProps: { sx: { bgcolor: "#1e1b4b", color: C.text } } }}>
                      <MenuItem value="">None</MenuItem>
                      {options.map((o) => <MenuItem key={o} value={o} sx={{ fontSize: "0.85rem" }}>{o}</MenuItem>)}
                    </Select>
                  </FormControl>
                ))}

                <TextField label="Stars (1–5) *" name="rating" type="number" value={ratingOptions.rating}
                  onChange={handleRatingChange} fullWidth size="small" inputProps={{ min: 1, max: 5 }}
                  sx={{ mb: 1.5, ...inputSx }} />

                <TextField label="Review *" name="review" value={ratingOptions.review}
                  onChange={handleRatingChange} fullWidth size="small" multiline rows={4}
                  placeholder="Describe your experience…" sx={{ mb: 2, ...inputSx }} />

                <Button variant="contained" fullWidth onClick={submitRating} disabled={isSubmitting}
                  sx={{ background: "linear-gradient(135deg, #7c3aed, #4f46e5)", color: "#fff", py: 1.2, borderRadius: "8px", fontWeight: 600 }}>
                  {isSubmitting ? "Submitting…" : "SUBMIT RATING"}
                </Button>
              </Box>
            </Stack>
          </Box>
        )}
      </Box>

      <Snackbar open={snackbar.open} autoHideDuration={4000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        <Alert severity={snackbar.severity} onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
          sx={{ bgcolor: snackbar.severity === "success" ? "#064e3b" : "#7f1d1d", color: "#fff" }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}