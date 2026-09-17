/**
 * File: landing/app/blog/page.tsx
 * Author: yuntongsoft
 * Date: 2026/09/01
 * Blog listing page — displays all posts from content/blog/ sorted by date.
 * SEO-optimized with proper metadata and structured data.
 */
import Link from "next/link";
import type { Metadata } from "next";
import { getAllPosts } from "@/lib/blog";
import { getSEOMetadata } from "@/components/SEO";

export const metadata: Metadata = getSEOMetadata({
  title: "Blog",
  description: "Shopify app development tutorials, guides, and best practices. Learn about Functions, billing, OAuth, and more.",
  path: "/blog",
});

export default function BlogPage() {
  const posts = getAllPosts();

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      {/* Header */}
      <div className="mb-12">
        <Link href="/" className="text-emerald-600 hover:underline text-sm mb-4 inline-block">
          &larr; Back to home
        </Link>
        <h1 className="text-4xl font-bold text-gray-900 mb-3">Blog</h1>
        <p className="text-gray-600 text-lg">
          Shopify app development tutorials, guides, and best practices.
        </p>
      </div>

      {/* Post list */}
      {posts.length === 0 ? (
        <p className="text-gray-500">No posts yet. Check back soon!</p>
      ) : (
        <div className="space-y-8">
          {posts.map((post) => (
            <article key={post.slug} className="group">
              <Link href={`/blog/${post.slug}`} className="block">
                <time className="text-sm text-gray-500">
                  {new Date(post.date).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </time>
                <h2 className="text-xl font-semibold text-gray-900 group-hover:text-emerald-600 transition-colors mt-1 mb-2">
                  {post.title}
                </h2>
                <p className="text-gray-600 leading-relaxed">{post.description}</p>
                <span className="text-emerald-600 text-sm mt-2 inline-block group-hover:underline">
                  Read more &rarr;
                </span>
              </Link>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
