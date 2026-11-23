/** First focusable element on every page: jumps to <main id="main">. */
export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only rounded-md bg-green-950 px-4 py-3 font-heading text-sm font-semibold text-white shadow-raised focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:outline-lime-300"
    >
      Skip to main content
    </a>
  );
}
