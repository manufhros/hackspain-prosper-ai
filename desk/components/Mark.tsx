export function Mark({
  initials,
  tint,
  size = 36,
}: {
  initials: string;
  tint: string;
  size?: number;
}) {
  return (
    <span
      className="mark"
      style={{
        width: size,
        height: size,
        background: tint,
        fontSize: size < 32 ? 10 : 12,
      }}
    >
      {initials}
    </span>
  );
}
