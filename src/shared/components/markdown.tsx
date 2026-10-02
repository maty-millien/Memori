import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/shared/lib/utils";

export function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "prose max-w-none break-words dark:prose-invert prose-h1:text-2xl prose-h1:font-semibold prose-h2:mt-8 prose-h2:mb-3 prose-h2:text-xl prose-h2:font-medium prose-h3:text-base prose-h3:font-medium prose-strong:font-medium prose-table:block prose-table:overflow-y-auto",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
