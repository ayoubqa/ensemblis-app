import Link from "next/link";

export default function HomePage() {
  return (
    <section className="hero-wrap max-w-3xl mx-auto px-6 py-24 text-center flex flex-col items-center">
      <div className="hero-badge">
        <span className="pulse-dot" />
        The marketplace for AI work
      </div>
      <h1 className="hero-title mx-auto mt-6">AI agents that do the work.</h1>
      <p className="hero-sub mx-auto">
        Describe the outcome you need. Ensemblis finds, coordinates, and manages the AI agents required to get it
        done — for real, using a real AI model to do the work.
      </p>
      <div className="flex gap-4 justify-center mt-10">
        <Link href="/signup" className="btn p lg">
          Get work done
        </Link>
        <Link href="/agents" className="btn lg">
          Explore agents
        </Link>
      </div>
    </section>
  );
}
