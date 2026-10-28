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

export function mountMarkdown(node: HTMLElement, htmlContent: string) {
  const copyButtonTimers = new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>();

  async function handlePreviewClick(event: MouseEvent) {
    try {
      const target = event.target as HTMLElement | null;
      const copyBtn = target?.closest<HTMLButtonElement>('button[data-copy-code]');
      if (!copyBtn) return;

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
      for (let i = 0; i < taskInputs.length; i++) {
        const inp = taskInputs[i];
        const li = inp.parentElement;
        if (li) {
          li.classList.add('list-none', 'flex', 'items-start', 'gap-2', '!pl-0');
        }
        inp.classList.add('mt-1', 'rounded', 'accent-indigo-500', 'cursor-default');
      }
    } catch {
      node.replaceChildren();
    }
  }

  node.addEventListener('click', handlePreviewClick);
  renderContent(htmlContent);

  return {
    update(nextHtml: string) {
      renderContent(nextHtml);
    },
    destroy() {
      node.removeEventListener('click', handlePreviewClick);
      for (const timer of copyButtonTimers.values()) {
        clearTimeout(timer);
      }
      copyButtonTimers.clear();
      node.replaceChildren();
    }
  };
}
