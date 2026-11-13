import DOMPurify from 'dompurify';
import { marked, type Tokens } from 'marked';
import hljs from 'highlight.js';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

marked.use({
  renderer: {
    code({ text, lang }: Tokens.Code): string {
      const rawLang = (lang || '').trim().toLowerCase();
      const normalizedLang =
        rawLang === 'shell' || rawLang === 'zsh' || rawLang === 'sh'
          ? 'bash'
          : rawLang;
      const hasLang = !!(normalizedLang && hljs.getLanguage(normalizedLang));
      const isTerminal = /^(bash|sh|shell|zsh|cmd|bat|powershell|ps1|console|terminal)$/i.test(rawLang);

      let highlighted = '';
      if (hasLang) {
        try {
          highlighted = hljs.highlight(text, { language: normalizedLang, ignoreIllegals: true }).value;
        } catch {
          highlighted = escapeHtml(text);
        }
      } else if (!rawLang) {
        try {
          const autoRes = hljs.highlightAuto(text);
          highlighted = autoRes.value;
        } catch {
          highlighted = escapeHtml(text);
        }
      } else {
        highlighted = escapeHtml(text);
      }

      const langClass = rawLang ? ` language-${rawLang}` : '';
      const terminalClass = isTerminal ? ' code-terminal' : '';
      return `<pre class="${terminalClass}"><code class="hljs${langClass}${terminalClass}">${highlighted}</code></pre>`;
    }
  }
});

const PURIFY_CONFIG = {
  FORBID_TAGS: [
    'script',
    'style',
    'iframe',
    'object',
    'embed',
    'form',
    'button',
    'textarea',
    'select',
    'meta',
    'link',
    'base'
  ],
  FORBID_ATTR: [
    'onerror',
    'onload',
    'onclick',
    'onmouseover',
    'onfocus',
    'onblur',
    'oninput',
    'onchange',
    'onsubmit',
    'formaction',
    'xlink:href',
    'srcdoc'
  ]
};

if (typeof DOMPurify.addHook === 'function') {
  DOMPurify.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName === 'input') {
      const inputEl = node as HTMLInputElement;
      if (inputEl.getAttribute('type') !== 'checkbox') {
        inputEl.remove();
      } else {
        inputEl.setAttribute('disabled', 'true');
      }
    }
  });
}

const COPY_CODE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 pointer-events-none"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
const CHECK_CODE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 text-emerald-400 pointer-events-none"><path d="M20 6 9 17l-5-5"/></svg>`;
const SAFE_HREF_PROTOCOL_REGEX = /^(?:https?:|mailto:|#)/i;
const TRAILING_NEWLINE_REGEX = /\n$/;

export function renderSanitizedMarkdown(content: string): string {
  try {
    if (!content || !content.trim()) return '';
    const parsed = marked.parse(content, { async: false }) as string;
    return DOMPurify.sanitize(parsed, PURIFY_CONFIG) as string;
  } catch {
    return '';
  }
}

export type MountMarkdownOptions = {
  html: string;
  onToggleCheckbox?: (index: number, checked: boolean) => void;
};

const TASK_LINE_REGEX = /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+\[)([ xX])(\](?:[ \t]|$).*)$/;
const FENCE_LINE_REGEX = /^[ \t]*(`{3,}|~{3,})/;

export function toggleMarkdownCheckbox(
  markdown: string,
  targetIndex: number,
  checked: boolean
): string {
  const lineEnding = markdown.includes('\r\n') ? '\r\n' : '\n';
  const lines = markdown.split(/\r?\n/);
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;
  let currentCheckboxIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(FENCE_LINE_REGEX);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!inFence) {
        inFence = true;
        fenceChar = marker[0];
        fenceLen = marker.length;
      } else if (marker[0] === fenceChar && marker.length >= fenceLen) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;

    const taskMatch = line.match(TASK_LINE_REGEX);
    if (taskMatch) {
      if (currentCheckboxIndex === targetIndex) {
        lines[i] = `${taskMatch[1]}${checked ? 'x' : ' '}${taskMatch[3]}`;
        return lines.join(lineEnding);
      }
      currentCheckboxIndex++;
    }
  }

  return markdown;
}

export function mountMarkdown(node: HTMLElement, param: string | MountMarkdownOptions) {
  const copyButtonTimers = new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>();
  let currentOnToggleCheckbox = typeof param === 'string' ? undefined : param.onToggleCheckbox;
  let currentHtml = typeof param === 'string' ? param : param.html;

  function handleCheckboxChange(event: Event) {
    try {
      const target = event.target as HTMLElement | null;
      if (!(target instanceof HTMLInputElement)) return;
      const idxAttr = target.getAttribute('data-task-checkbox-index');
      if (idxAttr === null || !currentOnToggleCheckbox) return;
      const index = Number.parseInt(idxAttr, 10);
      if (!Number.isNaN(index)) {
        currentOnToggleCheckbox(index, target.checked);
      }
    } catch {}
  }

  async function handlePreviewClick(event: MouseEvent) {
    try {
      const target = event.target as HTMLElement | null;
      const copyBtn = target?.closest<HTMLButtonElement>('button[data-copy-code]');
      if (!copyBtn) {
        if (currentOnToggleCheckbox && target) {
          if (target.closest('a, button, input')) return;
          const taskContent = target.closest<HTMLElement>('[data-task-content-index]');
          if (!taskContent) return;
          const ownerLi = taskContent.closest('li');
          if (!ownerLi || target.closest('li') !== ownerLi) return;
          const selection = window.getSelection();
          if (selection && selection.toString().length > 0) return;

          const idxAttr = taskContent.getAttribute('data-task-content-index');
          if (idxAttr === null) return;
          const index = Number.parseInt(idxAttr, 10);
          if (Number.isNaN(index)) return;
          const checkbox = ownerLi.querySelector<HTMLInputElement>(
            `input[type="checkbox"][data-task-checkbox-index="${index}"]`
          );
          if (!checkbox) return;
          checkbox.checked = !checkbox.checked;
          currentOnToggleCheckbox(index, checkbox.checked);
        }
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const wrapper = copyBtn.closest('.code-block-wrapper');
      const codeEl = wrapper?.querySelector('code') || wrapper?.querySelector('pre');
      const rawText = codeEl?.textContent ?? '';
      const textToCopy = rawText.replace(TRAILING_NEWLINE_REGEX, '');

      await navigator.clipboard.writeText(textToCopy);

      copyBtn.innerHTML = CHECK_CODE_SVG;
      copyBtn.title = 'Copied!';
      const prevTimer = copyButtonTimers.get(copyBtn);
      if (prevTimer !== undefined) clearTimeout(prevTimer);

      const timer = setTimeout(() => {
        copyButtonTimers.delete(copyBtn);
        if (!copyBtn.isConnected) return;
        copyBtn.innerHTML = COPY_CODE_SVG;
        copyBtn.title = 'Copy code';
      }, 2000);
      copyButtonTimers.set(copyBtn, timer);
    } catch {}
  }

  function renderContent(nextHtml: string) {
    try {
      for (const timer of copyButtonTimers.values()) {
        clearTimeout(timer);
      }
      copyButtonTimers.clear();

      if (!nextHtml) {
        node.replaceChildren();
        return;
      }
      node.innerHTML = nextHtml;

      const anchors = node.querySelectorAll<HTMLAnchorElement>('a[href]');
      for (let i = 0; i < anchors.length; i++) {
        const anchor = anchors[i];
        const href = (anchor.getAttribute('href') || '').trim();
        if (!SAFE_HREF_PROTOCOL_REGEX.test(href)) {
          anchor.removeAttribute('href');
        } else {
          anchor.setAttribute('rel', 'noopener noreferrer');
          if (!href.startsWith('#')) {
            anchor.setAttribute('target', '_blank');
          }
        }
      }

      const preBlocks = node.querySelectorAll<HTMLPreElement>('pre');
      for (let i = 0; i < preBlocks.length; i++) {
        const pre = preBlocks[i];
        const wrapper = document.createElement('div');
        wrapper.className = 'code-block-wrapper relative group/code my-3';
        pre.parentNode?.insertBefore(wrapper, pre);
        pre.classList.add('!my-0', '!pr-12');
        wrapper.appendChild(pre);

        const code = pre.querySelector('code');
        if (code) {
          const isTerminal =
            pre.classList.contains('code-terminal') ||
            code.classList.contains('code-terminal') ||
            /language-(bash|sh|shell|zsh|cmd|bat|powershell|ps1|console|terminal)/i.test(code.className);
          if (isTerminal) {
            pre.classList.add('code-terminal');
            code.classList.add('code-terminal');
          }
        }

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('data-copy-code', 'true');
        btn.title = 'Copy code';
        btn.setAttribute('aria-label', 'Copy code');
        btn.className =
          'select-none absolute top-2 right-2 z-10 w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground/80 hover:text-foreground bg-white/5 hover:bg-white/15 border border-transparent hover:border-white/10 transition-all cursor-pointer';
        btn.innerHTML = COPY_CODE_SVG;
        wrapper.appendChild(btn);
      }

      const taskInputs = node.querySelectorAll<HTMLInputElement>('li > input[type="checkbox"]');
      const isInteractive = typeof currentOnToggleCheckbox === 'function';
      for (let i = 0; i < taskInputs.length; i++) {
        const inp = taskInputs[i];
        const li = inp.parentElement;
        if (li) {
          li.classList.add('list-none', 'flex', 'items-start', 'gap-2', '!pl-0');

          const checkboxWrap = document.createElement('span');
          checkboxWrap.className = 'inline-flex h-[1.75em] items-center shrink-0';
          li.insertBefore(checkboxWrap, inp);
          checkboxWrap.appendChild(inp);

          const contentWrap = document.createElement('div');
          contentWrap.className = isInteractive
            ? 'flex-1 min-w-0 break-words [&>p]:my-0 cursor-pointer select-text'
            : 'flex-1 min-w-0 break-words [&>p]:my-0';
          if (isInteractive) {
            contentWrap.setAttribute('data-task-content-index', String(i));
          }
          let sibling = checkboxWrap.nextSibling;
          while (sibling) {
            const next = sibling.nextSibling;
            contentWrap.appendChild(sibling);
            sibling = next;
          }
          li.appendChild(contentWrap);
        }
        if (isInteractive) {
          inp.disabled = false;
          inp.removeAttribute('disabled');
          inp.setAttribute('data-task-checkbox-index', String(i));
          inp.classList.add('!m-0', 'h-4', 'w-4', 'rounded', 'accent-indigo-500', 'cursor-pointer');
        } else {
          inp.disabled = true;
          inp.removeAttribute('data-task-checkbox-index');
          inp.classList.add('!m-0', 'h-4', 'w-4', 'rounded', 'accent-indigo-500', 'cursor-default');
        }
      }
    } catch {
      node.replaceChildren();
    }
  }

  node.addEventListener('click', handlePreviewClick);
  node.addEventListener('change', handleCheckboxChange);
  renderContent(currentHtml);

  return {
    update(nextParam: string | MountMarkdownOptions) {
      const nextHtml = typeof nextParam === 'string' ? nextParam : nextParam.html;
      const nextToggle = typeof nextParam === 'string' ? undefined : nextParam.onToggleCheckbox;
      const interactivityChanged = Boolean(currentOnToggleCheckbox) !== Boolean(nextToggle);
      currentOnToggleCheckbox = nextToggle;
      if (nextHtml !== currentHtml || interactivityChanged) {
        currentHtml = nextHtml;
        renderContent(nextHtml);
      }
    },
    destroy() {
      node.removeEventListener('click', handlePreviewClick);
      node.removeEventListener('change', handleCheckboxChange);
      for (const timer of copyButtonTimers.values()) {
        clearTimeout(timer);
      }
      copyButtonTimers.clear();
      node.replaceChildren();
    }
  };
}
