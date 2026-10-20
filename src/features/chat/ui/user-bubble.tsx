import { Bubble, BubbleContent } from "@/shared/ui/bubble";

export function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-end">
      <Bubble align="end" className="max-w-[70%] origin-bottom-right">
        <BubbleContent className="whitespace-pre-wrap">{text}</BubbleContent>
      </Bubble>
    </div>
  );
}
