#!/usr/bin/env node
/**
 * docs/** 마크다운 -> Notion 단방향 동기화 (flat 구조)
 *
 * 설계: docs/plan/notion-sync.md
 * - 부모 페이지(NOTION_PARENT_PAGE_ID) 아래에 문서를 평면(flat)으로 미러링.
 * - 페이지 제목 = docs 기준 상대경로(확장자 제외, 예: "architecture/current-state").
 * - 멱등: 제목이 같은 child page가 있으면 내용을 교체, 없으면 새로 생성.
 *   (상태 파일 없이 부모의 child_page 목록으로 매핑 → CI에서 stateless)
 *
 * 사용:
 *   NOTION_TOKEN=... NOTION_PARENT_PAGE_ID=... node scripts/notion-sync.mjs [file ...]
 *   인자로 파일을 주면 그 파일만, 없으면 docs/** 전체를 동기화.
 *
 * 토큰/부모 페이지가 없으면 아무 것도 하지 않고 정상 종료(초안 단계 안전장치).
 */
import { Client } from "@notionhq/client";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const TOKEN = process.env.NOTION_TOKEN;
const PARENT = process.env.NOTION_PARENT_PAGE_ID;
const DOCS_DIR = "docs";

// Notion 코드블록이 허용하는 언어만 통과시키고, 나머지는 plain text로.
const CODE_LANGS = new Set([
  "bash", "shell", "json", "yaml", "sql", "typescript", "javascript",
  "tsx", "jsx", "markdown", "mermaid", "docker", "diff", "plain text",
]);
const LANG_ALIAS = { sh: "bash", ts: "typescript", js: "javascript", yml: "yaml", dockerfile: "docker", md: "markdown" };

// ---------------------------------------------------------------- inline
/** 인라인 마크다운(**bold**, `code`, [text](url))을 Notion rich_text로 변환. */
function parseInline(text) {
  const out = [];
  let rest = text;
  const patterns = [
    { re: /\*\*([^*]+)\*\*/, ann: { bold: true } },
    { re: /`([^`]+)`/, ann: { code: true } },
    { re: /\[([^\]]+)\]\(([^)]+)\)/, link: true },
  ];
  while (rest.length) {
    let best = null;
    for (const p of patterns) {
      const m = p.re.exec(rest);
      if (m && (best === null || m.index < best.m.index)) best = { p, m };
    }
    if (!best) { pushText(out, rest); break; }
    if (best.m.index > 0) pushText(out, rest.slice(0, best.m.index));
    if (best.p.link) {
      out.push(rt(best.m[1], {}, best.m[2]));
    } else {
      out.push(rt(best.m[1], best.p.ann));
    }
    rest = rest.slice(best.m.index + best.m[0].length);
  }
  return out.length ? out : [rt("")];
}

function rt(content, annotations = {}, link = null) {
  return {
    type: "text",
    text: { content, link: link ? { url: link } : null },
    annotations,
  };
}

/** 2000자 제한을 넘는 plain 세그먼트는 잘라서 여러 rich_text로. */
function pushText(out, content) {
  for (let i = 0; i < content.length; i += 2000) {
    out.push(rt(content.slice(i, i + 2000)));
  }
}

// ---------------------------------------------------------------- blocks
function heading(level, text) {
  const t = `heading_${Math.min(level, 3)}`;
  return { object: "block", type: t, [t]: { rich_text: parseInline(text) } };
}
const paragraph = (text) => ({ object: "block", type: "paragraph", paragraph: { rich_text: parseInline(text) } });
const bullet = (text) => ({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: parseInline(text) } });
const numbered = (text) => ({ object: "block", type: "numbered_list_item", numbered_list_item: { rich_text: parseInline(text) } });
const todo = (text, checked) => ({ object: "block", type: "to_do", to_do: { rich_text: parseInline(text), checked } });
const quote = (text) => ({ object: "block", type: "quote", quote: { rich_text: parseInline(text) } });
const divider = () => ({ object: "block", type: "divider", divider: {} });

function codeBlock(code, langRaw) {
  let lang = (langRaw || "").toLowerCase();
  lang = LANG_ALIAS[lang] || lang;
  if (!CODE_LANGS.has(lang)) lang = "plain text";
  return {
    object: "block",
    type: "code",
    code: { rich_text: [rt(code.slice(0, 2000))], language: lang },
  };
}

function tableBlock(rows) {
  const cells = rows.map((r) => r.map((c) => parseInline(c)));
  const width = Math.max(...cells.map((r) => r.length));
  return {
    object: "block",
    type: "table",
    table: {
      table_width: width,
      has_column_header: true,
      has_row_header: false,
      children: cells.map((r) => ({
        object: "block",
        type: "table_row",
        table_row: { cells: padCells(r, width) },
      })),
    },
  };
}
function padCells(row, width) {
  const out = row.slice();
  while (out.length < width) out.push([rt("")]);
  return out;
}

const splitRow = (line) =>
  line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

/** 마크다운 문서 전체를 Notion 블록 배열로 변환(라인 기반). */
function mdToBlocks(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // 코드 펜스
    const fence = /^```(\w*)/.exec(line);
    if (fence) {
      const lang = fence[1];
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; // 닫는 펜스
      blocks.push(codeBlock(buf.join("\n"), lang));
      continue;
    }

    // 표 (헤더 + |---| 구분선)
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const rows = [splitRow(line)];
      i += 2; // 헤더 + 구분선
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(splitRow(lines[i++]));
      blocks.push(tableBlock(rows));
      continue;
    }

    // 빈 줄
    if (!line.trim()) { i++; continue; }

    // 구분선
    if (/^---+$/.test(line.trim())) { blocks.push(divider()); i++; continue; }

    // 헤딩
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { blocks.push(heading(h[1].length, h[2].trim())); i++; continue; }

    // 인용
    if (/^>\s?/.test(line)) {
      const buf = [line.replace(/^>\s?/, "")];
      i++;
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push(quote(buf.join("\n")));
      continue;
    }

    // 체크박스 / 글머리 / 번호 목록 (들여쓰기는 평면화)
    const todoM = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (todoM) { blocks.push(todo(todoM[2].trim(), todoM[1].toLowerCase() === "x")); i++; continue; }
    const bulletM = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bulletM) { blocks.push(bullet(bulletM[1].trim())); i++; continue; }
    const numM = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (numM) { blocks.push(numbered(numM[1].trim())); i++; continue; }

    // 일반 문단
    blocks.push(paragraph(line.trim()));
    i++;
  }
  return blocks;
}

// ---------------------------------------------------------------- notion io
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, k) => arr.slice(k * n, k * n + n));

// 부모 페이지별 child_page(title -> id) 목록을 캐시. 폴더 미러링에 사용.
const childCache = new Map();
async function getChildren(notion, parentId) {
  if (childCache.has(parentId)) return childCache.get(parentId);
  const map = new Map();
  let cursor;
  do {
    const res = await notion.blocks.children.list({ block_id: parentId, start_cursor: cursor, page_size: 100 });
    for (const b of res.results) {
      if (b.type === "child_page") map.set(b.child_page.title, b.id);
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  childCache.set(parentId, map);
  return map;
}

/** 폴더용 컨테이너 페이지를 보장(없으면 생성). 내용은 비우지 않는다(하위 문서 보존). */
async function ensureFolder(notion, parentId, name) {
  const kids = await getChildren(notion, parentId);
  if (kids.has(name)) return kids.get(name);
  const page = await notion.pages.create({
    parent: { page_id: parentId },
    properties: { title: { title: [{ text: { content: name } }] } },
  });
  kids.set(name, page.id);
  return page.id;
}

async function clearPage(notion, pageId) {
  let cursor;
  do {
    const res = await notion.blocks.children.list({ block_id: pageId, start_cursor: cursor, page_size: 100 });
    for (const b of res.results) await notion.blocks.delete({ block_id: b.id });
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
}

async function appendAll(notion, pageId, blocks) {
  for (const part of chunk(blocks, 100)) {
    await notion.blocks.children.append({ block_id: pageId, children: part });
  }
}

/** 잎(문서) 페이지를 보장. 있으면 내용 교체, 없으면 생성. */
async function ensureDocPage(notion, parentId, title, blocks) {
  const kids = await getChildren(notion, parentId);
  const pageId = kids.get(title);
  if (pageId) {
    await clearPage(notion, pageId);
    await appendAll(notion, pageId, blocks);
    return "updated";
  }
  const page = await notion.pages.create({
    parent: { page_id: parentId },
    properties: { title: { title: [{ text: { content: title } }] } },
    children: blocks.slice(0, 100),
  });
  kids.set(title, page.id);
  if (blocks.length > 100) await appendAll(notion, page.id, blocks.slice(100));
  return "created";
}

/** 상대경로의 폴더는 컨테이너 페이지로 중첩, 파일명은 잎 페이지로. */
async function syncFile(notion, rel, md) {
  const blocks = mdToBlocks(md);
  const parts = rel.split("/");
  const fname = parts.pop().replace(/\.md$/, "");
  let parentId = PARENT;
  for (const dir of parts) parentId = await ensureFolder(notion, parentId, dir);
  const action = await ensureDocPage(notion, parentId, fname, blocks);
  return `${action}  ${rel}`;
}

// ---------------------------------------------------------------- walk
async function walkDocs(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walkDocs(full)));
    else if (e.name.endsWith(".md")) out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------- main
async function main() {
  if (!TOKEN || !PARENT) {
    console.log("NOTION_TOKEN / NOTION_PARENT_PAGE_ID 미설정 — sync 스킵.");
    return;
  }
  const notion = new Client({ auth: TOKEN });

  const args = process.argv.slice(2).filter((a) => a.endsWith(".md") && a.replace(/\\/g, "/").startsWith("docs/"));
  const files = args.length ? args : await walkDocs(DOCS_DIR);
  if (!files.length) { console.log("동기화할 docs 마크다운 없음."); return; }

  for (const file of files) {
    const rel = path.relative(DOCS_DIR, file).split(path.sep).join("/");
    const md = await readFile(file, "utf8");
    try {
      console.log(await syncFile(notion, rel, md));
    } catch (err) {
      console.error(`failed   ${rel}: ${err.message}`);
      process.exitCode = 1;
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
