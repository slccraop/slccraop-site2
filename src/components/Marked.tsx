// Wraps owner-fillable markers like [VERIFY: ...] so they are impossible to miss on screen.
const MARKER = /(\[(?:VERIFY|LEGAL REVIEW REQUIRED|STAGE 3)[^\]]*\])/;

export function Marked({ text }: { text: string }) {
  return (
    <>
      {text.split(MARKER).map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="marker">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}
