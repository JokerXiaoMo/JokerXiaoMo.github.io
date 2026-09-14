/* 轻量 Markdown 渲染器 · 无依赖 · 供前台阅读与后台实时预览共用 */
(function (global) {
  'use strict';

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function inline(text) {
    let s = escapeHtml(text);
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1" loading="lazy">');
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    return s;
  }

  function isTableDivider(line) {
    return /^\s*\|?[\s:-]*-[\s|:-]*\|?\s*$/.test(line) && line.indexOf('-') !== -1;
  }

  function splitRow(line) {
    return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(function (c) { return c.trim(); });
  }

  function render(markdown) {
    const src = String(markdown == null ? '' : markdown).replace(/\r\n/g, '\n');
    const lines = src.split('\n');
    const codes = [];
    const html = [];
    let i = 0;
    let paragraph = [];

    function flush() {
      if (!paragraph.length) return;
      html.push('<p>' + inline(paragraph.join(' ')) + '</p>');
      paragraph = [];
    }

    while (i < lines.length) {
      const line = lines[i];

      if (/^\s*```/.test(line)) {
        const lang = line.replace(/^\s*```\s*/, '').trim();
        const buf = [];
        i += 1;
        while (i < lines.length && !/^\s*```/.test(lines[i])) {
          buf.push(lines[i]);
          i += 1;
        }
        i += 1;
        codes.push('<pre><code' + (lang ? ' data-lang="' + escapeHtml(lang) + '"' : '') + '>' +
          escapeHtml(buf.join('\n')) + '</code></pre>');
        flush();
        html.push('\u0000CODE' + (codes.length - 1) + '\u0000');
        continue;
      }

      if (/^\s*$/.test(line)) {
        flush();
        i += 1;
        continue;
      }

      if (/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        flush();
        html.push('<hr>');
        i += 1;
        continue;
      }

      const heading = /^(#{1,4})\s+(.*)$/.exec(line);
      if (heading) {
        flush();
        const level = Math.min(Math.max(heading[1].length, 2), 5);
        html.push('<h' + level + '>' + inline(heading[2]) + '</h' + level + '>');
        i += 1;
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        flush();
        const buf = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          buf.push(lines[i].replace(/^\s*>\s?/, ''));
          i += 1;
        }
        html.push('<blockquote>' + render(buf.join('\n')) + '</blockquote>');
        continue;
      }

      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
        flush();
        const head = splitRow(line);
        i += 2;
        const rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
          rows.push(splitRow(lines[i]));
          i += 1;
        }
        let table = '<table><thead><tr>';
        head.forEach(function (c) { table += '<th>' + inline(c) + '</th>'; });
        table += '</tr></thead><tbody>';
        rows.forEach(function (row) {
          table += '<tr>';
          head.forEach(function (_, idx) { table += '<td>' + inline(row[idx] || '') + '</td>'; });
          table += '</tr>';
        });
        table += '</tbody></table>';
        html.push(table);
        continue;
      }

      if (/^\s*[-*+]\s+/.test(line)) {
        flush();
        const items = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
          i += 1;
        }
        html.push('<ul>' + items.map(function (t) { return '<li>' + inline(t) + '</li>'; }).join('') + '</ul>');
        continue;
      }

      if (/^\s*\d+[.)]\s+/.test(line)) {
        flush();
        const items = [];
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
          i += 1;
        }
        html.push('<ol>' + items.map(function (t) { return '<li>' + inline(t) + '</li>'; }).join('') + '</ol>');
        continue;
      }

      paragraph.push(line.trim());
      i += 1;
    }

    flush();

    return html.join('\n').replace(/\u0000CODE(\d+)\u0000/g, function (_, idx) {
      return codes[Number(idx)];
    });
  }

  function plain(markdown, limit) {
    const text = String(markdown == null ? '' : markdown)
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[#>*`_~|-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (limit && text.length > limit) return text.slice(0, limit) + '…';
    return text;
  }

  global.TZMarkdown = { render: render, plain: plain };
})(window);
