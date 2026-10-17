import { messageText, type MemoriUIMessage } from "@/shared/lib/memori";
import { Bubble, BubbleContent } from "@/shared/ui/bubble";

export function UserTurn({ message }: { message: MemoriUIMessage }) {
  return (
    <div className="flex flex-col items-end gap-2">
      <Bubble variant="secondary" align="end" className="max-w-[70%]">
        <BubbleContent className="whitespace-pre-wrap">
          {messageText(message.parts)}
        </BubbleContent>
      </Bubble>
    </div>
  );
}
