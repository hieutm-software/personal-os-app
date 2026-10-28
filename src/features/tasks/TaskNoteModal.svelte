<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import {
    Eye,
    Pencil,
    Save,
    List,
    SquareCheck,
    Quote,
    FileText,
    X,
    Folder,
    Copy,
    Check
  } from 'lucide-svelte';
  import type { Task, TaskGroup } from '../../shared/db/schema';
  import { taskStore } from '../../shared/taskStore.svelte';
  import { toastState } from '../../shared/toast.svelte';
  import { renderSanitizedMarkdown, mountMarkdown } from '../../shared/utils/markdown';
  import TabSwitcher from '../../shared/ui/TabSwitcher.svelte';
  import Button from '../../shared/ui/Button.svelte';
  import Modal from '../../shared/ui/Modal.svelte';

  interface EditorSnapshot {
    content: string;
    selectionStart: number;
    selectionEnd: number;
  }

  const MAX_HISTORY_STACK_SIZE = 200;
  const MAX_NOTE_CONTENT_LENGTH = 5000;
  const CHECKLIST_PREFIX_REGEX = /^(\s*[-*+]\s+\[[ xX]\]\s*)/;
  const BULLET_PREFIX_REGEX = /^(\s*[-*+]\s+(?!\[[ xX]\]))/;
  const QUOTE_PREFIX_REGEX = /^(\s*>\s?)/;
  const HEADING_PREFIX_REGEX = /^(\s*#{1,6}\s*)/;

  const EDITOR_MODE_TABS = [
    { value: 'preview', label: 'Preview', icon: Eye },
    { value: 'write', label: 'Editor', icon: Pencil }
  ];

  let {
    isOpen = $bindable(false),
    task = null,
    group = undefined,
    onClose,
    onSave
  }: {
    isOpen: boolean;
    task: Task | null;
    group?: TaskGroup | undefined;
    onClose?: () => void;
    onSave?: (newContent: string | null) => Promise<void> | void;
  } = $props();

  let editorMode = $state<'write' | 'preview'>('preview');
  let localContent = $state('');
  let isCopied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;
  let textareaRef = $state<HTMLTextAreaElement | null>(null);
  let previewRef = $state<HTMLDivElement | null>(null);

  async function handleCopyNoteContent() {
    try {
      await navigator.clipboard.writeText(localContent);
      isCopied = true;
      if (copyTimer !== null) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        copyTimer = null;
        isCopied = false;
      }, 2000);
    } catch {}
  }
  let sharedScrollRatio = 0;
  let scrollSyncFrameId: number | null = null;
  let textUpdateFrameId: number | null = null;

  function cancelPendingFrames() {
    if (scrollSyncFrameId !== null) {
      cancelAnimationFrame(scrollSyncFrameId);
      scrollSyncFrameId = null;
    }
    if (textUpdateFrameId !== null) {
      cancelAnimationFrame(textUpdateFrameId);
      textUpdateFrameId = null;
    }
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

  function scheduleScrollSync(ratio: number) {
    if (scrollSyncFrameId !== null) {
      cancelAnimationFrame(scrollSyncFrameId);
    }
    scrollSyncFrameId = requestAnimationFrame(() => {
      scrollSyncFrameId = null;
      applyScrollRatioToElement(textareaRef, ratio);
      applyScrollRatioToElement(previewRef, ratio);
    });
  }

  function switchEditorMode(nextMode: 'write' | 'preview') {
    if (nextMode === editorMode) return;
    if (editorMode === 'write' && textareaRef) {
      sharedScrollRatio = getScrollRatio(textareaRef);
    } else if (editorMode === 'preview' && previewRef) {
      sharedScrollRatio = getScrollRatio(previewRef);
    }
    editorMode = nextMode;
    scheduleScrollSync(sharedScrollRatio);
  }

  let historyStack = $state<EditorSnapshot[]>([]);
  let historyIndex = $state<number>(-1);
  let isApplyingHistory = false;
  let historyDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let editorFocusTimer: ReturnType<typeof setTimeout> | null = null;
  let lastTaskId: string | null = null;

  $effect(() => {
    if (isOpen && task) {
      const currentId = task.id;
      if (lastTaskId !== currentId) {
        lastTaskId = currentId;
        untrack(() => {
          localContent = task.description ?? '';
          sharedScrollRatio = 0;
          editorMode = localContent.trim().length > 0 ? 'preview' : 'write';
          initEditorHistory();
          scheduleScrollSync(0);
        });
      }
    } else {
      lastTaskId = null;
    }
  });

  let isDirty = $derived.by(() => {
    if (!task) return false;
    const original = task.description ?? '';
    return localContent !== original;
  });

  let sanitizedPreviewHtml = $derived.by(() => {
    if (!localContent.trim()) return '';
    return renderSanitizedMarkdown(localContent);
  });

  const taskGroupMap = $derived.by(() => {
    const map = new Map<string, TaskGroup>();
    const list = taskStore.taskGroups;
    for (let i = 0, len = list.length; i < len; i++) {
      const g = list[i];
      if (g && g.id) map.set(g.id, g);
    }
    return map;
  });

  const parentGroup = $derived(
    group?.parentId ? taskGroupMap.get(group.parentId) : undefined
  );

  function clearHistoryTimer() {
    if (historyDebounceTimer !== null) {
      clearTimeout(historyDebounceTimer);
      historyDebounceTimer = null;
    }
  }

  function clearEditorFocusTimer() {
    if (editorFocusTimer !== null) {
      clearTimeout(editorFocusTimer);
      editorFocusTimer = null;
    }
  }

  function scheduleEditorSelection(callback: () => void) {
    clearEditorFocusTimer();
    editorFocusTimer = setTimeout(() => {
      editorFocusTimer = null;
      try {
        callback();
      } catch {}
    }, 0);
  }

  function getCurrentSnapshot(customSelection?: { start: number; end: number }): EditorSnapshot {
    const start = customSelection
      ? customSelection.start
      : textareaRef?.selectionStart ?? localContent.length;
    const end = customSelection
      ? customSelection.end
      : textareaRef?.selectionEnd ?? localContent.length;
    return {
      content: localContent,
      selectionStart: start,
      selectionEnd: end
    };
  }

  function initEditorHistory() {
    clearHistoryTimer();
    const initial: EditorSnapshot = {
      content: localContent,
      selectionStart: 0,
      selectionEnd: 0
    };
    historyStack = [initial];
    historyIndex = 0;
  }

  function commitEditorSnapshot(customSelection?: { start: number; end: number }) {
    if (isApplyingHistory || !isOpen) return;
    clearHistoryTimer();
    const snap = getCurrentSnapshot(customSelection);
    const currentTop = historyStack[historyIndex];
    if (currentTop && currentTop.content === snap.content) {
      currentTop.selectionStart = snap.selectionStart;
      currentTop.selectionEnd = snap.selectionEnd;
      return;
    }
    const nextStack = historyStack.slice(0, historyIndex + 1);
    nextStack.push(snap);
    if (nextStack.length > MAX_HISTORY_STACK_SIZE) {
      nextStack.shift();
    }
    historyStack = nextStack;
    historyIndex = historyStack.length - 1;
  }

  function syncCurrentSelectionToHistory() {
    if (isApplyingHistory || historyDebounceTimer !== null || !textareaRef) return;
    const currentTop = historyStack[historyIndex];
    if (currentTop && currentTop.content === localContent) {
      currentTop.selectionStart = textareaRef.selectionStart;
      currentTop.selectionEnd = textareaRef.selectionEnd;
    }
  }

  function handleEditorInput(event?: Event) {
    if (isApplyingHistory) return;
    const inputEv = event as InputEvent | undefined;
    const currentTop = historyStack[historyIndex];
    const diffLen = currentTop ? Math.abs(localContent.length - currentTop.content.length) : 0;
    const inputType = inputEv?.inputType || '';
    const lastChar = inputEv?.data || '';

    if (
      diffLen > 1 ||
      inputType.startsWith('insertFrom') ||
      inputType.startsWith('deleteBy') ||
      inputType === 'insertLineBreak' ||
      lastChar === ' ' ||
      lastChar === '\n'
    ) {
      commitEditorSnapshot();
      return;
    }

    clearHistoryTimer();
    historyDebounceTimer = setTimeout(() => {
      historyDebounceTimer = null;
      commitEditorSnapshot();
    }, 300);
  }

  function handleBeforeEditorInput(event: InputEvent) {
    if (event.inputType === 'historyUndo') {
      event.preventDefault();
      undoEditor();
    } else if (event.inputType === 'historyRedo') {
      event.preventDefault();
      redoEditor();
    }
  }

  function applySnapshot(snap: EditorSnapshot) {
    isApplyingHistory = true;
    localContent = snap.content;

    scheduleEditorSelection(() => {
      try {
        textareaRef?.focus();
        textareaRef?.setSelectionRange(snap.selectionStart, snap.selectionEnd);
      } catch {} finally {
        isApplyingHistory = false;
      }
    });
  }

  function undoEditor() {
    if (!isOpen) return;
    if (historyDebounceTimer !== null) {
      commitEditorSnapshot();
    } else {
      const currentTop = historyStack[historyIndex];
      const nowSnap = getCurrentSnapshot();
      if (currentTop && currentTop.content !== nowSnap.content) {
        commitEditorSnapshot();
      }
    }
    if (historyIndex > 0) {
      historyIndex -= 1;
      applySnapshot(historyStack[historyIndex]);
    }
  }

  function redoEditor() {
    if (!isOpen) return;
    clearHistoryTimer();
    if (historyIndex < historyStack.length - 1) {
      historyIndex += 1;
      applySnapshot(historyStack[historyIndex]);
    }
  }

  function getLineRange(text: string, start: number, end: number) {
    let lineStart = start;
    while (lineStart > 0 && text[lineStart - 1] !== '\n') {
      lineStart--;
    }
    let lineEnd = end;
    while (lineEnd < text.length && text[lineEnd] !== '\n') {
      lineEnd++;
    }
    return { lineStart, lineEnd };
  }

  function matchesDelimiter(
    text: string,
    pos: number,
    delim: string,
    direction: 'before' | 'after'
  ): boolean {
    if (direction === 'before') {
      if (pos < delim.length) return false;
      const slice = text.substring(pos - delim.length, pos);
      if (slice !== delim) return false;
      if (delim === '*') {
        if (pos > 1 && text[pos - 2] === '*') return false;
      }
      if (delim === '`') {
        if (pos > 1 && text[pos - 2] === '`') return false;
      }
      return true;
    } else {
      if (pos + delim.length > text.length) return false;
      const slice = text.substring(pos, pos + delim.length);
      if (slice !== delim) return false;
      if (delim === '*') {
        if (pos + 1 < text.length && text[pos + 1] === '*') return false;
      }
      if (delim === '`') {
        if (pos + 1 < text.length && text[pos + 1] === '`') return false;
      }
      return true;
    }
  }

  function applyTextUpdate(
    replacement: string,
    replaceStart: number,
    replaceEnd: number,
    selectionStart: number,
    selectionEnd: number
  ) {
    if (editorMode !== 'write') switchEditorMode('write');
    const textarea = textareaRef;
    if (!textarea) return;

    const savedScrollTop = textarea.scrollTop;
    const savedScrollLeft = textarea.scrollLeft;

    textarea.setRangeText(replacement, replaceStart, replaceEnd, 'preserve');
    localContent = textarea.value;

    commitEditorSnapshot({ start: selectionStart, end: selectionEnd });

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

  function insertMarkdown(prefix: string, suffix: string = '') {
    try {
      if (editorMode !== 'write') switchEditorMode('write');
      const textarea = textareaRef;
      if (!textarea) return;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const text = textarea.value;
      const selected = text.substring(start, end);

      if (selected) {
        let isWrappedInside = false;
        if (selected.length >= prefix.length + suffix.length) {
          if (prefix === '```\n' || prefix.startsWith('```')) {
            isWrappedInside = selected.startsWith('```') && selected.endsWith('```') && selected.length >= 6;
          } else {
            const starts =
              prefix === '*'
                ? selected.startsWith('*') && !selected.startsWith('**')
                : prefix === '`'
                ? selected.startsWith('`') && !selected.startsWith('``')
                : selected.startsWith(prefix);
            const ends =
              suffix === '*'
                ? selected.endsWith('*') && !selected.endsWith('**')
                : suffix === '`'
                ? selected.endsWith('`') && !selected.endsWith('``')
                : selected.endsWith(suffix);
            isWrappedInside = starts && ends;
          }
        }

        if (isWrappedInside) {
          let inner = '';
          if (prefix === '```\n' || prefix.startsWith('```')) {
            inner = selected.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '');
          } else {
            inner = selected.substring(prefix.length, selected.length - suffix.length);
          }
          applyTextUpdate(inner, start, end, start, start + inner.length);
          return;
        }

        if (
          matchesDelimiter(text, start, prefix, 'before') &&
          matchesDelimiter(text, end, suffix, 'after')
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
        matchesDelimiter(text, start, prefix, 'before') &&
        matchesDelimiter(text, end, suffix, 'after')
      ) {
        applyTextUpdate(
          '',
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
        const validP = matchesDelimiter(text, pIdx + prefix.length, prefix, 'before');
        const validS = matchesDelimiter(text, sIdx, suffix, 'after');
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
    } catch {}
  }

  function toggleLinePrefix(type: 'quote' | 'bullet' | 'checklist') {
    try {
      if (editorMode !== 'write') switchEditorMode('write');
      const textarea = textareaRef;
      if (!textarea) return;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const text = textarea.value;
      const { lineStart, lineEnd } = getLineRange(text, start, end);

      const selectedBlock = text.substring(lineStart, lineEnd);
      const lines = selectedBlock.split('\n');

      function hasPrefix(l: string): boolean {
        if (type === 'quote') return QUOTE_PREFIX_REGEX.test(l);
        if (type === 'checklist') return CHECKLIST_PREFIX_REGEX.test(l);
        if (type === 'bullet') return BULLET_PREFIX_REGEX.test(l);
        return false;
      }

      function removePrefix(l: string): string {
        if (type === 'quote') return l.replace(QUOTE_PREFIX_REGEX, '');
        if (type === 'checklist') return l.replace(CHECKLIST_PREFIX_REGEX, '');
        if (type === 'bullet') return l.replace(BULLET_PREFIX_REGEX, '');
        return l;
      }

      function applyPrefix(l: string): string {
        if (type === 'quote') {
          if (l.trim() === '') return '> ';
          return `> ${l}`;
        }
        if (type === 'checklist') {
          if (l.trim() === '') return '- [ ] ';
          if (BULLET_PREFIX_REGEX.test(l)) return l.replace(BULLET_PREFIX_REGEX, '- [ ] ');
          return `- [ ] ${l}`;
        }
        if (type === 'bullet') {
          if (l.trim() === '') return '- ';
          if (CHECKLIST_PREFIX_REGEX.test(l)) return l.replace(CHECKLIST_PREFIX_REGEX, '- ');
          return `- ${l}`;
        }
        return l;
      }

      const isSingleLine = lines.length === 1;

      let allHavePrefix = true;
      if (isSingleLine) {
        allHavePrefix = hasPrefix(lines[0]);
      } else {
        const nonEmpties = lines.filter((l) => l.trim() !== '' || hasPrefix(l));
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
          const allBlank = lines.every((item) => item.trim() === '' && !hasPrefix(item));
          if (l.trim() !== '' || allBlank) {
            const applied = applyPrefix(l);
            if (idx === 0) deltaFirstLine = applied.length - l.length;
            return applied;
          }
          return l;
        }
      });

      const replacement = newLines.join('\n');

      let selStart = lineStart;
      let selEnd = lineStart + replacement.length;

      if (start === end) {
        if (isSingleLine) {
          if (lines[0].trim() === '' && !allHavePrefix) {
            const pos = lineStart + replacement.length;
            selStart = pos;
            selEnd = pos;
          } else if (lines[0].trim() === '' || (hasPrefix(lines[0]) && removePrefix(lines[0]).trim() === '')) {
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
    } catch {}
  }

  function toggleList() {
    toggleLinePrefix('bullet');
  }

  function toggleTaskList() {
    toggleLinePrefix('checklist');
  }

  function toggleQuote() {
    toggleLinePrefix('quote');
  }

  function toggleHeading(level: 2 | 3) {
    try {
      if (editorMode !== 'write') switchEditorMode('write');
      const textarea = textareaRef;
      if (!textarea) return;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const text = textarea.value;
      const { lineStart, lineEnd } = getLineRange(text, start, end);

      const selectedBlock = text.substring(lineStart, lineEnd);
      const lines = selectedBlock.split('\n');
      const targetPrefix = level === 2 ? '## ' : '### ';

      function hasTargetHeading(l: string): boolean {
        return l.trimStart().startsWith(targetPrefix);
      }

      function removeHeading(l: string): string {
        return l.replace(HEADING_PREFIX_REGEX, '');
      }

      function applyHeading(l: string): string {
        if (l.trim() === '') return targetPrefix;
        return `${targetPrefix}${removeHeading(l)}`;
      }

      const isSingleLine = lines.length === 1;

      let allHaveTarget = true;
      if (isSingleLine) {
        allHaveTarget = hasTargetHeading(lines[0]);
      } else {
        const nonEmpties = lines.filter((l) => l.trim() !== '' || hasTargetHeading(l));
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
          const allBlank = lines.every((item) => item.trim() === '' && !hasTargetHeading(item));
          if (l.trim() !== '' || allBlank) {
            const applied = applyHeading(l);
            if (idx === 0) deltaFirstLine = applied.length - l.length;
            return applied;
          }
          return l;
        }
      });

      const replacement = newLines.join('\n');

      let selStart = lineStart;
      let selEnd = lineStart + replacement.length;

      if (start === end) {
        if (isSingleLine) {
          if (lines[0].trim() === '' && !allHaveTarget) {
            const pos = lineStart + replacement.length;
            selStart = pos;
            selEnd = pos;
          } else if (lines[0].trim() === '' || (hasTargetHeading(lines[0]) && removeHeading(lines[0]).trim() === '')) {
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
    } catch {}
  }

  async function saveEditor() {
    if (!task) return;
    try {
      commitEditorSnapshot();
      const safeContent = localContent.trim() ? localContent : null;
      if (onSave) {
        await onSave(safeContent);
      } else if (task.id && task.id !== 'temp-new-task') {
        await taskStore.updateTask(task.id, { description: safeContent });
      }
      if (task) {
        task.description = safeContent;
      }
      toastState.add('success', 'Note saved');
    } catch {
      toastState.add('error', 'Failed to save note');
    }
  }

  let isUnsavedModalOpen = $state(false);

  function handleClose() {
    if (copyTimer !== null) {
      clearTimeout(copyTimer);
      copyTimer = null;
    }
    isCopied = false;
    clearHistoryTimer();
    clearEditorFocusTimer();
    cancelPendingFrames();
    isUnsavedModalOpen = false;
    isOpen = false;
    if (onClose) onClose();
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

  function handleEditorKeydown(event: KeyboardEvent) {
    if (!isOpen) return;
    if (event.key === 'Escape') {
      if (isUnsavedModalOpen) {
        isUnsavedModalOpen = false;
        return;
      }
      attemptClose();
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        if (isDirty) {
          saveEditor();
        }
      } else if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          redoEditor();
        } else {
          undoEditor();
        }
      } else if (key === 'y') {
        event.preventDefault();
        redoEditor();
      } else if (key === 'b') {
        event.preventDefault();
        insertMarkdown('**', '**');
      } else if (key === 'i') {
        event.preventDefault();
        insertMarkdown('*', '*');
      } else if (key === 'u') {
        event.preventDefault();
        insertMarkdown('<u>', '</u>');
      } else if (key === 'x' && event.shiftKey) {
        event.preventDefault();
        insertMarkdown('~~', '~~');
      } else if (key === 'l') {
        event.preventDefault();
        if (event.shiftKey) {
          toggleTaskList();
        } else {
          toggleList();
        }
      } else if (key === 'q' && event.shiftKey) {
        event.preventDefault();
        toggleQuote();
      } else if (key === '2' && (event.altKey || event.shiftKey)) {
        event.preventDefault();
        toggleHeading(2);
      } else if (key === '3' && (event.altKey || event.shiftKey)) {
        event.preventDefault();
        toggleHeading(3);
      } else if (key === 'e') {
        event.preventDefault();
        if (historyDebounceTimer !== null) commitEditorSnapshot();
        switchEditorMode(editorMode === 'write' ? 'preview' : 'write');
      }
    }
  }

  onDestroy(() => {
    if (copyTimer !== null) {
      clearTimeout(copyTimer);
      copyTimer = null;
    }
    clearHistoryTimer();
    clearEditorFocusTimer();
    cancelPendingFrames();
  });
</script>

<svelte:window onkeydown={handleEditorKeydown} />

{#if isOpen && task}
  <div
    class="fixed inset-0 z-modal bg-background/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) attemptClose();
    }}
  >
    <div
      class="w-full h-full max-w-5xl flex flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
    >
      <div class="px-6 py-4 flex flex-row items-center justify-between shrink-0 border-b border-border">
        <div class="flex-1 pr-4 flex items-center justify-start min-w-0 overflow-hidden">
          <div class="inline-flex items-center gap-2.5 max-w-full min-w-0">
            <div class="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shrink-0">
              <FileText class="w-4 h-4 text-indigo-400" />
            </div>
            <h2 class="text-xl font-bold tracking-tight text-foreground truncate" title={task.title}>
              {task.title}
            </h2>
            <span
              class="text-xs uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full border shrink-0 {task.status === 'COMPLETED'
                ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                : 'text-amber-400 bg-amber-500/10 border-amber-500/20'}"
            >
              {task.status}
            </span>
          </div>
        </div>

        <div class="flex items-center gap-2 shrink-0">
          {#if group}
            <div
              class="flex items-center gap-1.5 bg-muted/60 text-muted-foreground border border-border text-xs font-medium px-2.5 py-1.5 rounded-lg max-w-48 min-w-0"
              title={parentGroup ? `${parentGroup.name} / ${group.name}` : group.name}
            >
              <Folder class="w-3 h-3 opacity-70 shrink-0" />
              <span class="truncate block min-w-0">
                {#if parentGroup}
                  <span class="opacity-60">{parentGroup.name} / </span>
                {/if}
                {group.name}
              </span>
            </div>
          {/if}

          <div
            class="flex items-center gap-1.5 bg-primary/10 text-primary border border-primary/20 text-xs font-semibold px-2.5 py-1.5 rounded-lg font-mono tracking-wide"
          >
            .md
          </div>

          <Button
            onclick={(event: MouseEvent) => {
              event.preventDefault();
              event.stopPropagation();
              saveEditor();
            }}
            disabled={!isDirty}
            variant={isDirty ? 'default' : 'outline'}
          >
            <Save class="w-4 h-4" />
            Save
          </Button>

          <Button
            variant="ghost"
            size="icon"
            class="text-muted-foreground"
            onclick={(event: MouseEvent) => {
              event.preventDefault();
              event.stopPropagation();
              attemptClose();
            }}
          >
            <X class="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div class="flex-1 overflow-hidden relative px-6 pb-6 pt-4">
        <div class="w-full h-full border border-border rounded-xl flex flex-col bg-card">
          <div class="flex flex-col border-b border-border">
            <div class="px-4 py-3">
              <TabSwitcher
                tabs={EDITOR_MODE_TABS}
                value={editorMode}
                onValueChange={(val) => {
                  if (historyDebounceTimer !== null) commitEditorSnapshot();
                  switchEditorMode(val as 'write' | 'preview');
                }}
              />
            </div>

            <div class="w-full h-px bg-border"></div>

            <div class="flex items-center px-6 py-2.5 text-muted-foreground overflow-x-auto select-none">
              <div class="flex items-center gap-1">
                <button
                  type="button"
                  class="w-7 h-7 flex items-center justify-center rounded-md hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                  title="Bold (Ctrl+B)"
                  onpointerdown={(e) => e.preventDefault()}
                  onmousedown={(e) => e.preventDefault()}
                  onclick={() => insertMarkdown('**', '**')}
                >
                  <span class="font-bold font-serif text-sm">B</span>
                </button>
                <button
                  type="button"
                  class="w-7 h-7 flex items-center justify-center rounded-md hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                  title="Italic (Ctrl+I)"
                  onpointerdown={(e) => e.preventDefault()}
                  onmousedown={(e) => e.preventDefault()}
                  onclick={() => insertMarkdown('*', '*')}
                >
                  <span class="italic font-serif text-sm">I</span>
                </button>
                <button
                  type="button"
                  class="w-7 h-7 flex items-center justify-center rounded-md hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                  title="Underline (Ctrl+U)"
                  onpointerdown={(e) => e.preventDefault()}
                  onmousedown={(e) => e.preventDefault()}
                  onclick={() => insertMarkdown('<u>', '</u>')}
                >
                  <span class="underline underline-offset-2 font-serif text-sm font-medium">U</span>
                </button>
                <button
                  type="button"
                  class="w-7 h-7 flex items-center justify-center rounded-md hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                  title="Strikethrough (Ctrl+Shift+X)"
                  onpointerdown={(e) => e.preventDefault()}
                  onmousedown={(e) => e.preventDefault()}
                  onclick={() => insertMarkdown('~~', '~~')}
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
                  onclick={toggleList}
                >
                  <List class="w-4 h-4" />
                </button>
                <button
                  type="button"
                  class="w-7 h-7 flex items-center justify-center rounded-md hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                  title="Checklist / Task list (- [ ]) (Ctrl+Shift+L)"
                  onpointerdown={(e) => e.preventDefault()}
                  onmousedown={(e) => e.preventDefault()}
                  onclick={toggleTaskList}
                >
                  <SquareCheck class="w-4 h-4" />
                </button>
                <button
                  type="button"
                  class="w-7 h-7 flex items-center justify-center rounded-md hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                  title="Quote (>) (Ctrl+Shift+Q)"
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
                  onclick={() => insertMarkdown('`', '`')}
                >
                  &lt;&gt;
                </button>
                <button
                  type="button"
                  class="w-7 h-7 flex items-center justify-center rounded-md hover:text-foreground hover:bg-muted transition-colors cursor-pointer font-mono text-xs font-bold"
                  title="Code Block (```)"
                  onpointerdown={(e) => e.preventDefault()}
                  onmousedown={(e) => e.preventDefault()}
                  onclick={() => insertMarkdown('```\n', '\n```')}
                >
                  ```
                </button>
              </div>
            </div>
          </div>

          <div class="flex-1 overflow-hidden min-h-0 relative">
            <button
              type="button"
              onclick={handleCopyNoteContent}
              title={isCopied ? 'Copied!' : 'Copy content to clipboard'}
              aria-label="Copy content to clipboard"
              class="select-none absolute top-2.5 right-3 z-20 w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground/80 hover:text-foreground bg-white/5 hover:bg-white/15 border border-transparent hover:border-white/10 transition-all cursor-pointer"
            >
              {#if isCopied}
                <Check class="w-4 h-4 text-emerald-400 pointer-events-none" />
              {:else}
                <Copy class="w-4 h-4 pointer-events-none" />
              {/if}
            </button>
            <textarea
              bind:this={textareaRef}
              bind:value={localContent}
              onscroll={() => {
                if (editorMode === 'write' && textareaRef) {
                  sharedScrollRatio = getScrollRatio(textareaRef);
                }
              }}
              oninput={handleEditorInput}
              onbeforeinput={handleBeforeEditorInput}
              onselect={syncCurrentSelectionToHistory}
              onkeyup={syncCurrentSelectionToHistory}
              onpointerup={syncCurrentSelectionToHistory}
              maxlength={MAX_NOTE_CONTENT_LENGTH}
              spellcheck="false"
              autocapitalize="off"
              style="scroll-behavior: auto;"
              class="w-full h-full p-6 bg-transparent text-foreground resize-none focus:outline-none focus:ring-0 font-mono text-sm leading-relaxed {editorMode !==
              'write'
                ? 'hidden'
                : ''}"
            ></textarea>
            <div
              bind:this={previewRef}
              onscroll={() => {
                if (editorMode === 'preview' && previewRef) {
                  sharedScrollRatio = getScrollRatio(previewRef);
                }
              }}
              style="scroll-behavior: auto;"
              class="w-full h-full p-6 overflow-auto prose dark:prose-invert max-w-none text-foreground select-text {editorMode ===
              'write'
                ? 'hidden'
                : ''}"
              use:mountMarkdown={sanitizedPreviewHtml}
            ></div>
          </div>

          <div class="px-6 py-2.5 border-t border-border flex items-center justify-between text-xs text-muted-foreground shrink-0 bg-muted/10">
            <span class="font-mono text-xs {localContent.length >= 5000 ? 'text-destructive font-semibold' : localContent.length >= 4800 ? 'text-amber-500' : 'text-muted-foreground'}">
              {localContent.length} / 5000 characters
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}

<Modal bind:isOpen={isUnsavedModalOpen} title="Unsaved Changes" className="max-w-md">
  <div class="py-2 text-sm text-foreground/90 leading-relaxed">
    You have unsaved changes in this note. Do you want to save your changes before exiting?
  </div>

  {#snippet footer()}
    <div class="flex items-center justify-end gap-2 w-full pt-2">
      <Button variant="outline" onclick={() => (isUnsavedModalOpen = false)}>Keep Editing</Button>
      <Button variant="destructive" onclick={forceClose}>Discard</Button>
      <Button
        variant="default"
        onclick={async () => {
          await saveEditor();
          forceClose();
        }}
      >
        Save & Exit
      </Button>
    </div>
  {/snippet}
</Modal>
