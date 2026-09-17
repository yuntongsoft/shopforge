/**
 * File: landing/app/blog/[slug]/page.tsx
 * Author: yuntongsoft
 * Date: 2026/09/01
 * Blog post detail page — renders a single Markdown post with SEO metadata.
 * Dynamic route: /blog/[slug]
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAllPosts, getPostBySlug, markdownToHtml } from "@/lib/blog";
import { getSEOMetadata } from "@/components/SEO";

interface PageProps {
  params: { slug: string };
}

/**
 * Generate static paths for all blog posts at build time.
 */
export function generateStaticParams() {
  const posts = getAllPosts();
  return posts.map((post) => ({ slug: post.slug }));
}

/**
 * Generate per-post SEO metadata from frontmatter.
 */
export function generateMetadata({ params }: PageProps): Metadata {
  const post = getPostBySlug(params.slug);
  if (!post) return {};

  return getSEOMetadata({
    title: post.title,
    description: post.description,
    path: `/blog/${post.slug}`,
    type: "article",
    publishedTime: post.date,
    author: post.author,
  });
}

export default function BlogPostPage({ params }: PageProps) {
  const post = getPostBySlug(params.slug);
  if (!post) notFound();

  const htmlContent = markdownToHtml(post.content);

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      {/* Back link */}
      <Link href="/blog" className="text-emerald-600 hover:underline text-sm mb-8 inline-block">
        &larr; Back to blog
      </Link>

      {/* Article header */}
      <header className="mb-10">
        <time className="text-sm text-gray-500">
          {new Date(post.date).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </time>
        <h1 className="text-4xl font-bold text-gray-900 mt-2 mb-3">{post.title}</h1>
        <p className="text-gray-600 text-lg">{post.description}</p>
        <div className="flex items-center gap-2 mt-4 text-sm text-gray-500">
          <span>By {post.author}</span>
        </div>
      </header>

      {/* Article body */}
      <article
        className="prose-custom"
        dangerouslySetInnerHTML={{ __html: htmlContent }}
      />

      {/* Footer navigation */}
      <div className="mt-16 pt-8 border-t border-gray-200">
        <Link
          href="/blog"
          className="text-emerald-600 hover:underline font-medium"
        >
          &larr; All posts
        </Link>
      </div>
    </div>
  );
}
