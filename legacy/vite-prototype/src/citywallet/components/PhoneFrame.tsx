import type { ReactNode } from "react";

export function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="w-full max-w-[380px] surface-card rounded-[2rem] overflow-hidden h-[760px] flex flex-col mx-auto">
      {children}
    </div>
  );
}