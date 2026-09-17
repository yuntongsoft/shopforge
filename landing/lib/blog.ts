/**
 * File: landing/lib/blog.ts
 * Author: yuntongsoft
 * Date: 2026/08/26
 * Blog utility — parses Markdown files from content/blog/ with gray-matter frontmatter.
 *
 * Usage:
 *   import { getAllPosts, getPostBySlug } from "@/lib/blog";
 *   const posts = getAllPosts();
 *   const post = getPostBySlug("getting-started");
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import matter from "gray-matter";

/**
 * Resolve content path relative to this file (not process.cwd()),
 * so it works regardless of which directory the process was started from.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BLOG_DIR = path.join(__dirname, "..", "content", "blog");

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  date: string;
  author: string;
  content: string;
}

/**
 * Get all blog posts sorted by date (newest first).
 * Reads Markdown files from content/blog/ and parses frontmatter.
 */
export function getAllPosts(): BlogPost[] {
  if (!fs.existsSync(BLOG_DIR)) return [];

  const files = fs.readdirSync(BLOG_DIR).filter((f) => f.endsWith(".md"));

  const posts = files
    .map((filename) => {
      const slug = filename.replace(/\.md$/, "");
      const filePath = path.join(BLOG_DIR, filename);
      const fileContent = fs.readFileSync(filePath, "utf-8");
      const { data, content } = matter(fileContent);

      return {
        slug,
        title: data.title || slug,
        description: data.description || "",
        date: data.date || new Date().toISOString(),
        author: data.author || "ShopForge Team",
        content,
      } as BlogPost;
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return posts;
}

/**
 * Get a single blog post by its slug (filename without .md extension).
 * Returns null if the post is not found.
 */
export function getPostBySlug(slug: string): BlogPost | null {
  const filePath = path.join(BLOG_DIR, `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;

  const fileContent = fs.readFileSync(filePath, "utf-8");
  const { data, content } = matter(fileContent);

  return {
    slug,
    title: data.title || slug,
    description: data.description || "",
    date: data.date || new Date().toISOString(),
    author: data.author || "ShopForge Team",
    content,
  };
}

/**
 * Convert Markdown content to simple HTML.
 * Handles headings, paragraphs, code blocks, links, bold, italic, lists, and horizontal rules.
 * For production use, consider using a proper Markdown renderer like remark/rehype.
 */
export function markdownToHtml(markdown: string): string {
  let html = markdown
    // Code blocks (```...```)
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="bg-gray-900 text-gray-100 rounded-lg p-4 overflow-x-auto my-4"><code>$2</code></pre>')
    // Inline code (`...`)
    .replace(/`([^`]+)`/g, '<code class="bg-gray-100 text-gray-800 px-1.5 py-0.5 rounded text-sm">$1</code>')
    // H3
    .replace(/^### (.+)$/gm, '<h3 class="text-xl font-semibold text-gray-900 mt-8 mb-3">$1</h3>')
    // H2
    .replace(/^## (.+)$/gm, '<h2 class="text-2xl font-bold text-gray-900 mt-10 mb-4">$1</h2>')
    // H1
    .replace(/^# (.+)$/gm, '<h1 class="text-3xl font-bold text-gray-900 mt-10 mb-4">$1</h1>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Italic
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Links [text](url)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-emerald-600 hover:underline">$1</a>')
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc text-gray-700">$1</li>')
    // Horizontal rule
    .replace(/^---$/gm, '<hr class="my-8 border-gray-200" />')
    // Paragraphs (lines not already wrapped in tags)
    .replace(/^(?!<[a-z])((?!^\s*$).+)$/gm, '<p class="text-gray-700 leading-relaxed mb-4">$1</p>');

  // Wrap consecutive <li> items in <ul>
  html = html.replace(/((?:<li[^>]*>.*<\/li>\n?)+)/g, '<ul class="my-4 space-y-2">$1</ul>');

  return html;
}
