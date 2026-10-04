"use client";

import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const cell = { whiteSpace: "normal", verticalAlign: "top", minWidth: 110 } as const;

const components: Components = {
  // Tables use the prototype's table styling inside a scrollable `.tw` frame
  // (`not-prose` opts them out of the typography plugin's table look).
  table: ({ node: _node, ...props }) => (
    <div className="tw not-prose" style={{ margin: "16px 0" }}>
      <table {...props} />
    </div>
  ),
  th: ({ node: _node, style, ...props }) => <th style={{ ...cell, ...style }} {...props} />,
  td: ({ node: _node, style, ...props }) => <td style={{ ...cell, ...style }} {...props} />,
  a: ({ node: _node, href, ...props }) => (
    <a href={href} {...props} {...(href && /^https?:/.test(href) ? { target: "_blank", rel: "noopener noreferrer" } : {})} />
  ),
};

/** Markdown from the API (agent output / final report), GFM tables included. */
export function Md({ children, small, className }: { children: string; small?: boolean; className?: string }) {
  return (
    <div className={["prose max-w-none", small && "prose-sm", className].filter(Boolean).join(" ")}>
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </Markdown>
    </div>
  );
}
