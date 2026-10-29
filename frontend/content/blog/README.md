# content/blog

Articles for the Ensemblis Journal (`/blog`). One Markdown file per article; the file name is the URL slug.
Copy `_template.md` to start. Files beginning with `_` and this README are ignored by the site.

The full workflow — states, frontmatter, citations, callouts, images, scheduling, the editor's checklist —
is in [`docs/growth/03-publishing.md`](../../../docs/growth/03-publishing.md).

Check your work: `npm run content:check` (from `frontend/`). A `published` article needs `approvedBy`,
`factCheckedAt`, `publishedAt` and sources; the build fails without them.
