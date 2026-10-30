<script lang="ts">
  import { onDestroy, onMount, untrack } from "svelte";
  import {
    FileText,
    Save,
    Maximize2,
    Minimize2,
    X,
    List,
    Quote,
    SquareCheck,
    Eye,
    Pencil,
    Columns,
    Link2,
    Link2Off,
    Copy,
    Check,
  } from "lucide-svelte";
  import { renderSanitizedMarkdown, mountMarkdown } from "../../shared/utils/markdown";
  import { readTextFile, writeTextFile, moveFile } from "./api";
  import { toastState } from "../../shared/toast.svelte";
  import TabSwitcher from "../../shared/ui/TabSwitcher.svelte";
  import Button from "../../shared/ui/Button.svelte";
  import Modal from "../../shared/ui/Modal.svelte";

  let {
    isOpen = $bindable(false),
    filePath = "",
    fileName = "",
    basePath = null,
    onClose,
    onSaved,
  }: {
    isOpen: boolean;
    filePath: string;
    fileName: string;
    basePath?: string | null;
    onClose?: () => void;
    onSaved?: (newPath: string, newName: string) => void;
  } = $props();

  const MAX_FILE_STEM_LENGTH = 200;
  const INVALID_FILENAME_CHARS_PATTERN = /[<>:"/\\|?*\u0000-\u001F\u007F]/;
  const RESERVED_WINDOWS_NAMES_PATTERN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  const CHECKLIST_PREFIX_REGEX = /^(\s*[-*+]\s+\[[ xX]\]\s*)/;
  const BULLET_PREFIX_REGEX = /^(\s*[-*+]\s+(?!\[[ xX]\]))/;
  const QUOTE_PREFIX_REGEX = /^(\s*>\s?)/;
  const HEADING_PREFIX_REGEX = /^(\s*#{1,6}\s*)/;

  const EDITOR_MODE_TABS = [
    { value: "write", label: "Write", icon: Pencil },
    { value: "split", label: "Split", icon: Columns },
    { value: "preview", label: "Preview", icon: Eye },
  ];

  let content = $state("");
  let initialContent = $state("");
  let currentFileStem = $state("");
  let initialFileStem = $state("");
  let fileExtension = $state(".md");
  let currentFilePath = $state("");
  let isLoading = $state(false);
  let isSaving = $state(false);
  let isMaximized = $state(false);
  let editorMode = $state<"write" | "split" | "preview">("split");
  let isSyncScrollEnabled = $state(true);
  let isCopied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;
  let textareaRef = $state<HTMLTextAreaElement | null>(null);
  let previewRef = $state<HTMLDivElement | null>(null);

  function splitFileNameAndExt(rawName: string): { stem: string; ext: string } {
    const trimmed = rawName.trim();
    const lastDot = trimmed.lastIndexOf(".");
    if (lastDot > 0 && lastDot < trimmed.length - 1) {
      return {
        stem: trimmed.slice(0, lastDot),
        ext: trimmed.slice(lastDot),
      };
    }
    return {
      stem: trimmed || "Untitled",
      ext: ".md",
    };
  }

  function normalizeStem(rawStem: string, ext: string): string {
    let cleaned = rawStem.trim();
    if (ext && cleaned.toLowerCase().endsWith(ext.toLowerCase()) && cleaned.length > ext.length) {
      cleaned = cleaned.slice(0, cleaned.length - ext.length).trim();
    }
    return cleaned;
  }

  function isValidFileStem(rawStem: string, ext: string): boolean {
    const normalized = normalizeStem(rawStem, ext);
    if (
      !normalized ||
      normalized.length > MAX_FILE_STEM_LENGTH ||
      normalized === "." ||
      normalized === ".." ||
      INVALID_FILENAME_CHARS_PATTERN.test(normalized) ||
      RESERVED_WINDOWS_NAMES_PATTERN.test(normalized)
    ) {
      return false;
    }
    return true;
  }

  async function handleCopyNoteContent() {
    try {
      await navigator.clipboard.writeText(content);
      isCopied = true;
      if (copyTimer !== null) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        copyTimer = null;
        isCopied = false;
      }, 2000);
    } catch {}
  }

  let sharedScrollRatio = 0;
  let activeScrollSource: "write" | "preview" | null = null;
  let scrollUnlockFrameId: number | null = null;
  let scrollSyncFrameId: number | null = null;
  let textUpdateFrameId: number | null = null;

  function cancelPendingFrames() {
    if (scrollUnlockFrameId !== null) {
      cancelAnimationFrame(scrollUnlockFrameId);
      scrollUnlockFrameId = null;
    }
    if (scrollSyncFrameId !== null) {
      cancelAnimationFrame(scrollSyncFrameId);
      scrollSyncFrameId = null;
    }
    if (textUpdateFrameId !== null) {
      cancelAnimationFrame(textUpdateFrameId);
      textUpdateFrameId = null;
    }
    activeScrollSource = null;
  }

  function getScrollRatio(el: HTMLElement): number {
    const maxScroll = el.scrollHeight - el.clientHeight;
    if (maxScroll <= 0) return 0;
    return Math.max(0, Math.min(1, el.scrollTop / maxScroll));
  }

  function applyScrollRatioToElement(el: HTMLElement | null, ratio: number) {
    if (!el) return;
    const maxScroll = el.scrollHeight - el.clientHeight;
    if (maxScroll <= 0) {
      el.scrollTop = 0;
      return;
    }
    el.scrollTop = Math.round(ratio * maxScroll);
  }

  function scheduleScrollUnlock() {
    if (scrollUnlockFrameId !== null) {
      cancelAnimationFrame(scrollUnlockFrameId);
    }
    scrollUnlockFrameId = requestAnimationFrame(() => {
      scrollUnlockFrameId = requestAnimationFrame(() => {
        activeScrollSource = null;
        scrollUnlockFrameId = null;
      });
    });
  }

  function scheduleScrollSync(ratio: number) {
    if (scrollSyncFrameId !== null) {
      cancelAnimationFrame(scrollSyncFrameId);
    }
    scrollSyncFrameId = requestAnimationFrame(() => {
      scrollSyncFrameId = null;
      syncBothScrollPositions(ratio);
    });
  }

  function handleWriteScroll() {
    try {
      if (!textareaRef || activeScrollSource === "preview") return;
      activeScrollSource = "write";
      sharedScrollRatio = getScrollRatio(textareaRef);
      if (editorMode === "split" && isSyncScrollEnabled && previewRef) {
        applyScrollRatioToElement(previewRef, sharedScrollRatio);
      }
      scheduleScrollUnlock();
    } catch {}
  }

  function handlePreviewScroll() {
    try {
      if (!previewRef || activeScrollSource === "write") return;
      activeScrollSource = "preview";
      sharedScrollRatio = getScrollRatio(previewRef);
      if (editorMode === "split" && isSyncScrollEnabled && textareaRef) {
        applyScrollRatioToElement(textareaRef, sharedScrollRatio);
      }
      scheduleScrollUnlock();
    } catch {}
  }

  function syncBothScrollPositions(ratio: number = sharedScrollRatio) {
    try {
      activeScrollSource = "write";
      applyScrollRatioToElement(textareaRef, ratio);
      applyScrollRatioToElement(previewRef, ratio);
      scheduleScrollUnlock();
    } catch {}
  }

  function toggleSyncScroll() {
    try {
      isSyncScrollEnabled = !isSyncScrollEnabled;
      if (isSyncScrollEnabled) {
        if (textareaRef) {
          sharedScrollRatio = getScrollRatio(textareaRef);
        }
        syncBothScrollPositions(sharedScrollRatio);
      }
    } catch {}
  }

  function switchEditorMode(nextMode: "write" | "split" | "preview") {
    try {
      if (nextMode === editorMode) return;
      if (editorMode === "write" && textareaRef) {
        sharedScrollRatio = getScrollRatio(textareaRef);
      } else if (editorMode === "preview" && previewRef) {
        sharedScrollRatio = getScrollRatio(previewRef);
      }
      editorMode = nextMode;
      if (isSyncScrollEnabled) {
        scheduleScrollSync(sharedScrollRatio);
      }
    } catch {}
  }

  const normalizedCurrentStem = $derived(normalizeStem(currentFileStem, fileExtension));
  const isDirty = $derived(content !== initialContent || normalizedCurrentStem !== initialFileStem);
  const wordCount = $derived.by(() => {
    const len = content.length;
    if (len === 0) return 0;
    let count = 0;
    let inWord = false;
    for (let i = 0; i < len; i++) {
      const code = content.charCodeAt(i);
      const isSpace = code === 32 || (code >= 9 && code <= 13) || code === 160;
      if (!isSpace) {
        if (!inWord) {
          inWord = true;
          count++;
        }
      } else {
        inWord = false;
      }
    }
    return count;
  });
  const charCount = $derived(content.length);

  const sanitizedPreviewHtml = $derived(renderSanitizedMarkdown(content));

  $effect(() => {
    if (isOpen && filePath) {
      const targetPath = filePath;
      const targetName = fileName;
      untrack(() => {
        if (currentFilePath !== targetPath) {
          currentFilePath = targetPath;
          const resolvedName = targetName || targetPath.split("/").pop() || "note.md";
          const { stem, ext } = splitFileNameAndExt(resolvedName);
          currentFileStem = stem;
          initialFileStem = stem;
          fileExtension = ext;
          loadContent(targetPath);
        }
      });
    } else if (!isOpen) {
      untrack(() => {
        currentFilePath = "";
        isUnsavedModalOpen = false;
      });
    }
  });

  async function loadContent(path: string) {
    isLoading = true;
    sharedScrollRatio = 0;
    try {
      const text = await readTextFile(path, basePath);
      content = text;
      initialContent = text;
    } catch {
      content = "";
      initialContent = "";
    } finally {
      isLoading = false;
      scheduleScrollSync(0);
    }
  }

  export async function save(): Promise<boolean> {
    if (isSaving || !currentFilePath) return false;
    const cleanStem = normalizeStem(currentFileStem, fileExtension);
    if (!isValidFileStem(cleanStem, fileExtension)) {
      toastState.add("error", "Invalid file name");
      return false;
    }
    isSaving = true;
    try {
      let activePath = currentFilePath;
      const fullNewName = `${cleanStem}${fileExtension}`;
      if (cleanStem !== initialFileStem) {
        const pathSegments = currentFilePath.split("/");
        pathSegments.pop();
        const targetPath = pathSegments.length > 0 ? `${pathSegments.join("/")}/${fullNewName}` : fullNewName;
        await moveFile(currentFilePath, targetPath, basePath, true);
        activePath = targetPath;
        currentFilePath = targetPath;
        initialFileStem = cleanStem;
        currentFileStem = cleanStem;
      } else if (currentFileStem !== cleanStem) {
        currentFileStem = cleanStem;
      }

      await writeTextFile(activePath, content, basePath, true);
      initialContent = content;
      toastState.add("success", "Document saved");
      onSaved?.(activePath, fullNewName);
      return true;
    } catch {
      toastState.add("error", "Failed to save document");
      return false;
    } finally {
      isSaving = false;
    }
  }

  let isUnsavedModalOpen = $state(false);

  let isUnreadOrClosedCleanup = () => {
    if (copyTimer !== null) {
      clearTimeout(copyTimer);
      copyTimer = null;
    }
    isCopied = false;
    cancelPendingFrames();
  };

  function handleClose() {
    isUnreadOrClosedCleanup();
    isUnsavedModalOpen = false;
    isOpen = false;
    onClose?.();
  }

  function attemptClose() {
    if (isDirty) {
      isUnsavedModalOpen = true;
    } else {
      forceClose();
    }
  }

  function forceClose() {
    isUnsavedModalOpen = false;
    handleClose();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (!isOpen) return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
      return;
    }

    if (e.key === "Escape" && !e.shiftKey && !e.ctrlKey && !e.altKey) {
      if (isUnsavedModalOpen) {
        isUnsavedModalOpen = false;
        return;
      }
      if (isMaximized) {
        isMaximized = false;
      } else {
        attemptClose();
      }
      return;
    }

    if (e.target === textareaRef && (e.ctrlKey || e.metaKey)) {
      const key = e.key.toLowerCase();
      if (key === "b") {
        e.preventDefault();
        insertFormatting("**", "**");
      } else if (key === "i") {
        e.preventDefault();
        insertFormatting("*", "*");
      } else if (key === "u") {
        e.preventDefault();
        insertFormatting("<u>", "</u>");
      } else if (key === "l") {
        e.preventDefault();
        toggleBulletList();
      }
    }
  }

  function getLineRange(text: string, start: number, end: number) {
    let lineStart = start;
    while (lineStart > 0 && text[lineStart - 1] !== "\n") {
      lineStart--;
    }
    let lineEnd = end;
    while (lineEnd < text.length && text[lineEnd] !== "\n") {
      lineEnd++;
    }
    return { lineStart, lineEnd };
  }

  function applyTextUpdate(
    replacement: string,
    replaceStart: number,
    replaceEnd: number,
    selectionStart: number,
    selectionEnd: number
  ) {
    const textarea = textareaRef;
    if (!textarea) return;

    const savedScrollTop = textarea.scrollTop;
    const savedScrollLeft = textarea.scrollLeft;

    textarea.setRangeText(replacement, replaceStart, replaceEnd, "preserve");
    content = textarea.value;

    textarea.setSelectionRange(selectionStart, selectionEnd);
    textarea.scrollTop = savedScrollTop;
    textarea.scrollLeft = savedScrollLeft;
    textarea.focus({ preventScroll: true });

    if (textUpdateFrameId !== null) {
      cancelAnimationFrame(textUpdateFrameId);
    }
    textUpdateFrameId = requestAnimationFrame(() => {
      textUpdateFrameId = null;
      if (!textarea) return;
      textarea.scrollTop = savedScrollTop;
      textarea.scrollLeft = savedScrollLeft;
      textarea.setSelectionRange(selectionStart, selectionEnd);
    });
  }

  function matchesDelimiter(
    text: string,
    pos: number,
    delim: string,
    direction: "before" | "after"
  ): boolean {
    if (direction === "before") {
      if (pos < delim.length) return false;
      const slice = text.substring(pos - delim.length, pos);
      if (slice !== delim) return false;
      if (delim === "*") {
        if (pos > 1 && text[pos - 2] === "*") return false;
      }
      if (delim === "`") {
        if (pos > 1 && text[pos - 2] === "`") return false;
      }
      return true;
    } else {
      if (pos + delim.length > text.length) return false;
      const slice = text.substring(pos, pos + delim.length);
      if (slice !== delim) return false;
      if (delim === "*") {
        if (pos + 1 < text.length && text[pos + 1] === "*") return false;
      }
      if (delim === "`") {
        if (pos + 1 < text.length && text[pos + 1] === "`") return false;
      }
      return true;
    }
  }

  function insertFormatting(prefix: string, suffix: string = "") {
    if (!textareaRef) return;
    const textarea = textareaRef;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selected = text.substring(start, end);

    if (selected) {
      let isWrappedInside = false;
      if (selected.length >= prefix.length + suffix.length) {
        if (prefix === "```\n" || prefix.startsWith("```")) {
          isWrappedInside = selected.startsWith("```") && selected.endsWith("```") && selected.length >= 6;
        } else {
          const starts =
            prefix === "*"
              ? selected.startsWith("*") && !selected.startsWith("**")
              : prefix === "`"
              ? selected.startsWith("`") && !selected.startsWith("``")
              : selected.startsWith(prefix);
          const ends =
            suffix === "*"
              ? selected.endsWith("*") && !selected.endsWith("**")
              : suffix === "`"
              ? selected.endsWith("`") && !selected.endsWith("``")
              : selected.endsWith(suffix);
          isWrappedInside = starts && ends;
        }
      }

      if (isWrappedInside) {
        let inner = "";
        if (prefix === "```\n" || prefix.startsWith("```")) {
          inner = selected.replace(/^```[^\n]*\n?/, "").replace(/\n?```$/, "");
        } else {
          inner = selected.substring(prefix.length, selected.length - suffix.length);
        }
        applyTextUpdate(inner, start, end, start, start + inner.length);
        return;
      }

      if (
        matchesDelimiter(text, start, prefix, "before") &&
        matchesDelimiter(text, end, suffix, "after")
      ) {
        applyTextUpdate(
          selected,
          start - prefix.length,
          end + suffix.length,
          start - prefix.length,
          start - prefix.length + selected.length
        );
        return;
      }

      const replacement = `${prefix}${selected}${suffix}`;
      applyTextUpdate(
        replacement,
        start,
        end,
        start + prefix.length,
        start + prefix.length + selected.length
      );
      return;
    }

    if (
      matchesDelimiter(text, start, prefix, "before") &&
      matchesDelimiter(text, end, suffix, "after")
    ) {
      applyTextUpdate(
        "",
        start - prefix.length,
        end + suffix.length,
        start - prefix.length,
        start - prefix.length
      );
      return;
    }

    const { lineStart, lineEnd } = getLineRange(text, start, end);
    const pIdx = text.lastIndexOf(prefix, start - 1);
    const sIdx = text.indexOf(suffix, end);
    if (pIdx >= lineStart && sIdx !== -1 && sIdx + suffix.length <= lineEnd) {
      const validP = matchesDelimiter(text, pIdx + prefix.length, prefix, "before");
      const validS = matchesDelimiter(text, sIdx, suffix, "after");
      if (validP && validS) {
        const betweenP = text.substring(pIdx + prefix.length, start);
        const betweenS = text.substring(end, sIdx);
        if (!betweenP.includes(prefix) && !betweenS.includes(suffix)) {
          const inner = text.substring(pIdx + prefix.length, sIdx);
          const newCursor = Math.max(pIdx, start - prefix.length);
          applyTextUpdate(inner, pIdx, sIdx + suffix.length, newCursor, newCursor);
          return;
        }
      }
    }

    const replacement = `${prefix}${suffix}`;
    const newCursor = start + prefix.length;
    applyTextUpdate(replacement, start, end, newCursor, newCursor);
  }

  function toggleLinePrefix(type: "quote" | "bullet" | "checklist") {
    if (!textareaRef) return;
    const textarea = textareaRef;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const { lineStart, lineEnd } = getLineRange(text, start, end);

    const selectedBlock = text.substring(lineStart, lineEnd);
    const lines = selectedBlock.split("\n");

    function hasPrefix(l: string): boolean {
      if (type === "quote") return QUOTE_PREFIX_REGEX.test(l);
      if (type === "checklist") return CHECKLIST_PREFIX_REGEX.test(l);
      if (type === "bullet") return BULLET_PREFIX_REGEX.test(l);
      return false;
    }

    function removePrefix(l: string): string {
      if (type === "quote") return l.replace(QUOTE_PREFIX_REGEX, "");
      if (type === "checklist") return l.replace(CHECKLIST_PREFIX_REGEX, "");
      if (type === "bullet") return l.replace(BULLET_PREFIX_REGEX, "");
      return l;
    }

    function applyPrefix(l: string): string {
      if (type === "quote") {
        if (l.trim() === "") return "> ";
        return `> ${l}`;
      }
      if (type === "checklist") {
        if (l.trim() === "") return "- [ ] ";
        if (BULLET_PREFIX_REGEX.test(l)) return l.replace(BULLET_PREFIX_REGEX, "- [ ] ");
        return `- [ ] ${l}`;
      }
      if (type === "bullet") {
        if (l.trim() === "") return "- ";
        if (CHECKLIST_PREFIX_REGEX.test(l)) return l.replace(CHECKLIST_PREFIX_REGEX, "- ");
        return `- ${l}`;
      }
      return l;
    }

    const isSingleLine = lines.length === 1;

    let allHavePrefix = true;
    if (isSingleLine) {
      allHavePrefix = hasPrefix(lines[0]);
    } else {
      const nonEmpties = lines.filter((l) => l.trim() !== "" || hasPrefix(l));
      if (nonEmpties.length === 0) {
        allHavePrefix = lines.every((l) => hasPrefix(l));
      } else {
        allHavePrefix = nonEmpties.every((l) => hasPrefix(l));
      }
    }

    let deltaFirstLine = 0;
    const newLines = lines.map((l, idx) => {
      if (allHavePrefix) {
        if (hasPrefix(l)) {
          const removed = removePrefix(l);
          if (idx === 0) deltaFirstLine = -(l.length - removed.length);
          return removed;
        }
        return l;
      } else {
        if (isSingleLine) {
          const applied = applyPrefix(l);
          deltaFirstLine = applied.length - l.length;
          return applied;
        }
        if (hasPrefix(l)) {
          return l;
        }
        const allBlank = lines.every((item) => item.trim() === "" && !hasPrefix(item));
        if (l.trim() !== "" || allBlank) {
          const applied = applyPrefix(l);
          if (idx === 0) deltaFirstLine = applied.length - l.length;
          return applied;
        }
        return l;
      }
    });

    const replacement = newLines.join("\n");

    let selStart = lineStart;
    let selEnd = lineStart + replacement.length;

    if (start === end) {
      if (isSingleLine) {
        if (lines[0].trim() === "" && !allHavePrefix) {
          const pos = lineStart + replacement.length;
          selStart = pos;
          selEnd = pos;
        } else if (lines[0].trim() === "" || (hasPrefix(lines[0]) && removePrefix(lines[0]).trim() === "")) {
          selStart = lineStart;
          selEnd = lineStart;
        } else {
          const newPos = Math.max(lineStart, Math.min(lineStart + replacement.length, start + deltaFirstLine));
          selStart = newPos;
          selEnd = newPos;
        }
      } else {
        const newPos = Math.max(lineStart, Math.min(lineStart + replacement.length, start + deltaFirstLine));
        selStart = newPos;
        selEnd = newPos;
      }
    }

    applyTextUpdate(replacement, lineStart, lineEnd, selStart, selEnd);
  }

  function toggleBulletList() {
    toggleLinePrefix("bullet");
  }

  function toggleChecklist() {
    toggleLinePrefix("checklist");
  }

  function toggleQuote() {
    toggleLinePrefix("quote");
  }

  function toggleHeading(level: 2 | 3 = 2) {
    if (!textareaRef) return;
    const textarea = textareaRef;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const { lineStart, lineEnd } = getLineRange(text, start, end);

    const selectedBlock = text.substring(lineStart, lineEnd);
    const lines = selectedBlock.split("\n");
    const targetPrefix = level === 2 ? "## " : "### ";

    function hasTargetHeading(l: string): boolean {
      return l.trimStart().startsWith(targetPrefix);
    }

    function removeHeading(l: string): string {
      return l.replace(HEADING_PREFIX_REGEX, "");
    }

    function applyHeading(l: string): string {
      if (l.trim() === "") return targetPrefix;
      return `${targetPrefix}${removeHeading(l)}`;
    }

    const isSingleLine = lines.length === 1;

    let allHaveTarget = true;
    if (isSingleLine) {
      allHaveTarget = hasTargetHeading(lines[0]);
    } else {
      const nonEmpties = lines.filter((l) => l.trim() !== "" || hasTargetHeading(l));
      if (nonEmpties.length === 0) {
        allHaveTarget = lines.every((l) => hasTargetHeading(l));
      } else {
        allHaveTarget = nonEmpties.every((l) => hasTargetHeading(l));
      }
    }

    let deltaFirstLine = 0;
    const newLines = lines.map((l, idx) => {
      if (allHaveTarget) {
        if (hasTargetHeading(l)) {
          const removed = removeHeading(l);
          if (idx === 0) deltaFirstLine = -(l.length - removed.length);
          return removed;
        }
        return l;
      } else {
        if (isSingleLine) {
          const applied = applyHeading(l);
          deltaFirstLine = applied.length - l.length;
          return applied;
        }
        if (hasTargetHeading(l)) return l;
        const allBlank = lines.every((item) => item.trim() === "" && !hasTargetHeading(item));
        if (l.trim() !== "" || allBlank) {
          const applied = applyHeading(l);
          if (idx === 0) deltaFirstLine = applied.length - l.length;
          return applied;
        }
        return l;
      }
    });

    const replacement = newLines.join("\n");

    let selStart = lineStart;
    let selEnd = lineStart + replacement.length;

    if (start === end) {
      if (isSingleLine) {
        if (lines[0].trim() === "" && !allHaveTarget) {
          const pos = lineStart + replacement.length;
          selStart = pos;
          selEnd = pos;
        } else if (lines[0].trim() === "" || (hasTargetHeading(lines[0]) && removeHeading(lines[0]).trim() === "")) {
          selStart = lineStart;
          selEnd = lineStart;
        } else {
          const newPos = Math.max(lineStart, Math.min(lineStart + replacement.length, start + deltaFirstLine));
          selStart = newPos;
          selEnd = newPos;
        }
      } else {
        const newPos = Math.max(lineStart, Math.min(lineStart + replacement.length, start + deltaFirstLine));
        selStart = newPos;
        selEnd = newPos;
      }
    }

    applyTextUpdate(replacement, lineStart, lineEnd, selStart, selEnd);
  }

  onMount(() => {
    window.addEventListener("keydown", handleKeyDown);
  });

  onDestroy(() => {
    if (copyTimer !== null) {
      clearTimeout(copyTimer);
      copyTimer = null;
    }
    cancelPendingFrames();
    window.removeEventListener("keydown", handleKeyDown);
  });
</script>

{#if isOpen}
  <div
    class="fixed inset-0 z-modal bg-black/60 backdrop-blur-sm transition-opacity"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) attemptClose();
    }}
  >
    <div
      class="flex flex-col bg-card/95 border border-border/80 shadow-2xl transition-all duration-200 select-text {isMaximized
        ? 'fixed inset-0 z-modal rounded-none p-3 md:p-5'
        : 'fixed inset-3 md:inset-8 lg:inset-12 z-modal rounded-2xl p-4 md:p-6'}"
    >
      <header class="flex items-center justify-between gap-3 pb-3 border-b border-border/60 shrink-0">
        <div class="flex items-center gap-2.5 min-w-0 flex-1">
          <div class="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0">
            <FileText class="w-5 h-5" />
          </div>
          <div class="flex items-center gap-1.5 min-w-0 flex-1 max-w-md">
            <input
              type="text"
              bind:value={currentFileStem}
              placeholder="Note title..."
              maxlength={MAX_FILE_STEM_LENGTH}
              onkeydown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  (e.currentTarget as HTMLInputElement).blur();
                }
              }}
              onblur={() => {
                const cleaned = normalizeStem(currentFileStem, fileExtension);
                if (!cleaned) {
                  currentFileStem = initialFileStem;
                } else if (cleaned !== currentFileStem) {
                  currentFileStem = cleaned;
                }
              }}
              class="w-full min-w-[100px] px-2.5 py-1 text-sm md:text-base font-bold bg-transparent hover:bg-muted/30 focus:bg-background border border-transparent focus:border-border rounded-lg outline-none transition-colors truncate"
              title="Click to rename note"
            />
            <div
              class="flex items-center gap-1.5 bg-primary/10 text-primary border border-primary/20 text-xs font-semibold px-2.5 py-1.5 rounded-lg font-mono tracking-wide shrink-0 select-none"
              title="File format ({fileExtension})"
            >
              {fileExtension}
            </div>
          </div>
          {#if isDirty}
            <span class="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20 shrink-0 font-medium leading-none">
              Unsaved
            </span>
          {:else}
            <span class="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0 font-medium leading-none">
              Saved
            </span>
          {/if}
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <div class="hidden sm:block">
            <TabSwitcher
              tabs={EDITOR_MODE_TABS}
              value={editorMode}
              onValueChange={(val) => switchEditorMode(val as "write" | "split" | "preview")}
            />
          </div>

          <Button
            variant="default"
            size="sm"
            onclick={save}
            disabled={isSaving || !isDirty}
            title="Save (Ctrl+S)"
          >
            <Save class="w-4 h-4 mr-1.5" />
            <span class="hidden sm:inline">Save</span>
          </Button>

          <button
            type="button"
            class="p-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition-colors cursor-pointer"
            onclick={() => {
              if (editorMode === "write" && textareaRef) {
                sharedScrollRatio = getScrollRatio(textareaRef);
              } else if (editorMode === "preview" && previewRef) {
                sharedScrollRatio = getScrollRatio(previewRef);
              }
              isMaximized = !isMaximized;
              scheduleScrollSync(sharedScrollRatio);
            }}
            title={isMaximized ? "Restore view" : "Maximize (Focus mode)"}
            aria-label={isMaximized ? "Restore" : "Maximize"}
          >
            {#if isMaximized}
              <Minimize2 class="w-4 h-4" />
            {:else}
              <Maximize2 class="w-4 h-4" />
            {/if}
          </button>

          <button
            type="button"
            class="p-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition-colors cursor-pointer"
            onclick={attemptClose}
            title="Close (Esc)"
            aria-label="Close"
          >
            <X class="w-4 h-4" />
          </button>
        </div>
      </header>

      {#if editorMode !== "preview"}
        <div class="flex items-center px-4 py-2 border-b border-border/40 text-muted-foreground overflow-x-auto select-none shrink-0 text-xs">
          <div class="flex items-center gap-1">
            <button
              type="button"
              class="w-7 h-7 flex items-center justify-center rounded-md hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
              title="Bold (Ctrl+B)"
              onpointerdown={(e) => e.preventDefault()}
              onmousedown={(e) => e.preventDefault()}
              onclick={() => insertFormatting("**", "**")}
            >
              <span class="font-bold font-serif text-sm">B</span>
            </button>
            <button
              type="button"
              class="w-7 h-7 flex items-center justify-center rounded-md hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
              title="Italic (Ctrl+I)"
              onpointerdown={(e) => e.preventDefault()}
              onmousedown={(e) => e.preventDefault()}
              onclick={() => insertFormatting("*", "*")}
            >
              <span class="italic font-serif text-sm">I</span>
            </button>
            <button
              type="button"
              class="w-7 h-7 flex items-center justify-center rounded-md hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
              title="Underline (Ctrl+U)"
              onpointerdown={(e) => e.preventDefault()}
              onmousedown={(e) => e.preventDefault()}
              onclick={() => insertFormatting("<u>", "</u>")}
            >
              <span class="underline underline-offset-2 font-serif text-sm font-medium">U</span>
            </button>
            <button
              type="button"
              class="w-7 h-7 flex items-center justify-center rounded-md hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
              title="Strikethrough"
              onpointerdown={(e) => e.preventDefault()}
              onmousedown={(e) => e.preventDefault()}
              onclick={() => insertFormatting("~~", "~~")}
            >
              <span class="line-through font-serif text-sm font-medium">S</span>
            </button>
          </div>

          <div class="w-px h-4.5 bg-border mx-2.5 shrink-0"></div>

          <div class="flex items-center gap-1">
            <button
              type="button"
              class="w-7 h-7 flex items-center justify-center rounded-md hover:text-foreground hover:bg-muted transition-colors cursor-pointer font-bold text-xs"
              title="Heading 2 (##)"
              onpointerdown={(e) => e.preventDefault()}
              onmousedown={(e) => e.preventDefault()}
              onclick={() => toggleHeading(2)}
            >
              <span>H<sub class="text-xs -bottom-0.5">2</sub></span>
            </button>
            <button
              type="button"
              class="w-7 h-7 flex items-center justify-center rounded-md hover:text-foreground hover:bg-muted transition-colors cursor-pointer font-bold text-xs"
              title="Heading 3 (###)"
              onpointerdown={(e) => e.preventDefault()}
              onmousedown={(e) => e.preventDefault()}
              onclick={() => toggleHeading(3)}
            >
              <span>H<sub class="text-xs -bottom-0.5">3</sub></span>
            </button>
          </div>

          <div class="w-px h-4.5 bg-border mx-2.5 shrink-0"></div>

          <div class="flex items-center gap-1">
            <button
              type="button"
              class="w-7 h-7 flex items-center justify-center rounded-md hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
              title="Bullet List (Ctrl+L)"
              onpointerdown={(e) => e.preventDefault()}
              onmousedown={(e) => e.preventDefault()}
              onclick={toggleBulletList}
            >
              <List class="w-4 h-4" />
            </button>
            <button
              type="button"
              class="w-7 h-7 flex items-center justify-center rounded-md hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
              title="Checklist (- [ ])"
              onpointerdown={(e) => e.preventDefault()}
              onmousedown={(e) => e.preventDefault()}
              onclick={toggleChecklist}
            >
              <SquareCheck class="w-4 h-4" />
            </button>
            <button
              type="button"
              class="w-7 h-7 flex items-center justify-center rounded-md hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
              title="Quote (>)"
              onpointerdown={(e) => e.preventDefault()}
              onmousedown={(e) => e.preventDefault()}
              onclick={toggleQuote}
            >
              <Quote class="w-4 h-4" />
            </button>
          </div>

          <div class="w-px h-4.5 bg-border mx-2.5 shrink-0"></div>

          <div class="flex items-center gap-1">
            <button
              type="button"
              class="w-7 h-7 flex items-center justify-center rounded-md hover:text-foreground hover:bg-muted transition-colors cursor-pointer font-mono text-xs font-bold"
              title="Inline Code (`)"
              onpointerdown={(e) => e.preventDefault()}
              onmousedown={(e) => e.preventDefault()}
              onclick={() => insertFormatting("`", "`")}
            >
              &lt;&gt;
            </button>
            <button
              type="button"
              class="w-7 h-7 flex items-center justify-center rounded-md hover:text-foreground hover:bg-muted transition-colors cursor-pointer font-mono text-xs font-bold"
              title="Code Block (```)"
              onpointerdown={(e) => e.preventDefault()}
              onmousedown={(e) => e.preventDefault()}
              onclick={() => insertFormatting("```\n", "\n```")}
            >
              ```
            </button>
          </div>

          {#if editorMode === "split"}
            <div class="ml-auto flex items-center pl-2">
              <button
                type="button"
                class="h-7 px-2.5 flex items-center gap-1.5 rounded-md border text-xs font-medium transition-colors cursor-pointer {isSyncScrollEnabled
                  ? 'bg-primary/10 text-primary border-primary/25 hover:bg-primary/15'
                  : 'bg-transparent text-muted-foreground border-border/60 hover:text-foreground hover:bg-muted/50'}"
                title={isSyncScrollEnabled
                  ? "Sync Scroll: ON (Click to scroll panes independently)"
                  : "Sync Scroll: OFF (Click to lock scroll positions together)"}
                onpointerdown={(e) => e.preventDefault()}
                onmousedown={(e) => e.preventDefault()}
                onclick={toggleSyncScroll}
              >
                {#if isSyncScrollEnabled}
                  <Link2 class="w-3.5 h-3.5 shrink-0" />
                  <span class="hidden sm:inline">Sync Scroll</span>
                {:else}
                  <Link2Off class="w-3.5 h-3.5 shrink-0" />
                  <span class="hidden sm:inline">Independent</span>
                {/if}
              </button>
            </div>
          {/if}
        </div>
      {/if}

      <main class="flex-1 overflow-hidden min-h-0 relative my-2">
        {#if isLoading}
          <div class="flex items-center justify-center h-full text-muted-foreground text-sm">
            Loading document content...
          </div>
        {:else}
          <div
            class="w-full h-full border border-border/70 rounded-xl overflow-hidden flex flex-col md:flex-row bg-card/40 relative"
          >
            <button
              type="button"
              onclick={handleCopyNoteContent}
              title={isCopied ? "Copied!" : "Copy content to clipboard"}
              aria-label="Copy content to clipboard"
              class="select-none absolute top-2.5 right-3 z-20 w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground/80 hover:text-foreground bg-white/5 hover:bg-white/15 border border-transparent hover:border-white/10 transition-all cursor-pointer"
            >
              {#if isCopied}
                <Check class="w-4 h-4 text-emerald-400 pointer-events-none" />
              {:else}
                <Copy class="w-4 h-4 pointer-events-none" />
              {/if}
            </button>
            {#if editorMode === "split"}
              <button
                type="button"
                onclick={handleCopyNoteContent}
                title={isCopied ? "Copied!" : "Copy content to clipboard"}
                aria-label="Copy content to clipboard"
                class="hidden md:flex select-none absolute top-2.5 right-[calc(50%+0.75rem)] z-20 w-7 h-7 rounded-md items-center justify-center text-muted-foreground/80 hover:text-foreground bg-white/5 hover:bg-white/15 border border-transparent hover:border-white/10 transition-all cursor-pointer"
              >
                {#if isCopied}
                  <Check class="w-4 h-4 text-emerald-400 pointer-events-none" />
                {:else}
                  <Copy class="w-4 h-4 pointer-events-none" />
                {/if}
              </button>
            {/if}
            <textarea
              bind:this={textareaRef}
              bind:value={content}
              onscroll={handleWriteScroll}
              placeholder="Write your note here in Markdown..."
              spellcheck="false"
              style="scroll-behavior: auto;"
              class="p-4 md:p-6 bg-transparent text-foreground resize-none focus:outline-none font-mono text-sm leading-relaxed min-h-0 {editorMode ===
              'preview'
                ? 'hidden'
                : editorMode === 'split'
                  ? 'w-full h-1/2 md:w-1/2 md:h-full border-b md:border-b-0 md:border-r border-border/60'
                  : 'w-full h-full'}"
            ></textarea>
            <div
              bind:this={previewRef}
              onscroll={handlePreviewScroll}
              style="scroll-behavior: auto;"
              class="overflow-auto prose dark:prose-invert max-w-none text-foreground select-text min-h-0 {editorMode ===
              'write'
                ? 'hidden'
                : editorMode === 'split'
                  ? 'w-full h-1/2 md:w-1/2 md:h-full p-4 md:p-6 bg-muted/10'
                  : 'w-full h-full p-4 md:p-8'}"
              use:mountMarkdown={sanitizedPreviewHtml}
            ></div>
          </div>
        {/if}
      </main>

      <footer class="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border/40 shrink-0">
        <div class="flex items-center gap-3">
          <span>{wordCount} words</span>
          <span class="w-1 h-1 rounded-full bg-border"></span>
          <span>{charCount} characters</span>
        </div>
        <div class="text-muted-foreground/70 truncate max-w-md hidden sm:block">
          {currentFilePath}
        </div>
      </footer>
    </div>
  </div>
{/if}

<Modal bind:isOpen={isUnsavedModalOpen} title="Unsaved Changes" className="max-w-md">
  <div class="py-2 text-sm text-foreground/90 leading-relaxed">
    You have unsaved changes in this document. Do you want to save your changes before exiting?
  </div>

  {#snippet footer()}
    <div class="flex items-center justify-end gap-2 w-full pt-2">
      <Button variant="outline" onclick={() => (isUnsavedModalOpen = false)}>Keep Editing</Button>
      <Button variant="destructive" onclick={forceClose}>Discard</Button>
      <Button
        variant="default"
        onclick={async () => {
          const success = await save();
          if (success) {
            forceClose();
          }
        }}
      >
        Save & Exit
      </Button>
    </div>
  {/snippet}
</Modal>
