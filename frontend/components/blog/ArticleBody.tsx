// Server-rendered article body: the whole text is in the HTML (readable without JavaScript — for people,
// search engines and AI crawlers alike). Raw HTML in Markdown is not rendered; react-markdown's default URL
// filter drops javascript: and data: links.
import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import { localImageSize } from "@/lib/blog/images";
import { REMARK_PLUGINS } from "@/lib/blog/markdown";

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  children?: HastNode[];
}

const onlyImage = (node?: HastNode) => {
  const kids = (node?.children ?? []).filter((c) => !(c.type === "text" && !c.value?.trim()));
  return kids.length === 1 && kids[0].type === "element" && kids[0].tagName === "img";
};

const components: Components = {
  a({ href = "", children, node: _node, ...rest }) {
    void _node;
    if (href.startsWith("/") && !href.startsWith("//")) return <Link href={href}>{children}</Link>;
    const external = /^https?:\/\//i.test(href);
    return (
      <a href={href} {...rest} {...(external ? { rel: "noopener" } : {})}>
        {children}
      </a>
    );
  },
  // An image on its own line is a figure (a <figure> can't live inside a <p>).
  p({ node, children }) {
    if (onlyImage(node as HastNode | undefined)) return <>{children}</>;
    return <p>{children}</p>;
  },
  img({ src, alt, title }) {
    const url = typeof src === "string" ? src : "";
    // Intrinsic size reserves the figure's space before it loads; a narrow figure is never stretched past it.
    const size = localImageSize(url);
    return (
      <figure className="ed-fig">
        {/* Article images are author-supplied files under /public/blog; sized by CSS, lazy below the fold. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={alt ?? ""}
          loading="lazy"
          decoding="async"
          {...(size ? { width: size.width, height: size.height, style: { maxWidth: size.width } } : {})}
        />
        {title && <figcaption>{title}</figcaption>}
      </figure>
    );
  },
  // GFM task lists ("- [ ] item") are static checklists in an article: a decorative box, not a form control.
  input({ type, checked }) {
    if (type !== "checkbox") return null;
    return <span className={`ed-check${checked ? " on" : ""}`} aria-hidden="true" />;
  },
  table({ children }) {
    return (
      <div className="ed-table" role="region" aria-label="Table" tabIndex={0}>
        <table>{children}</table>
      </div>
    );
  },
};

export function ArticleBody({ markdown }: { markdown: string }) {
  return (
    <div className="ed-prose">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
