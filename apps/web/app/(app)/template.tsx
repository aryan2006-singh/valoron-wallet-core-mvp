// A template (unlike a layout) remounts on every navigation, so the
// entrance animation replays for each page in the signed-in shell.
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="enter">{children}</div>
}
