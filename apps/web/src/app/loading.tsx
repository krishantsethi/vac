export default function Loading() {
  return (
    <div className="fixed inset-0 z-[100] bg-navy flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-4 border-cyan/30 rounded-full border-t-cyan animate-[spin_1s_linear_infinite]" />
        <p className="text-text-secondary text-sm">Loading VAXBRIDGE AI</p>
      </div>
    </div>
  );
}
