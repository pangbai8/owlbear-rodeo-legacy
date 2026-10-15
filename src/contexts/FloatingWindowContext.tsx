import React, { useCallback, useContext, useState } from "react";

export type FloatingWindowName = "chat" | "sheets";

type FloatingWindowContextValue = {
  open: Partial<Record<FloatingWindowName, boolean>>;
  setOpen: (name: FloatingWindowName, open: boolean) => void;
  front: FloatingWindowName | null;
  bringToFront: (name: FloatingWindowName) => void;
};

const FloatingWindowContext = React.createContext<
  FloatingWindowContextValue | undefined
>(undefined);

export function FloatingWindowProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpenState] = useState<
    Partial<Record<FloatingWindowName, boolean>>
  >({});
  const [front, setFront] = useState<FloatingWindowName | null>(null);

  const setOpen = useCallback((name: FloatingWindowName, isOpen: boolean) => {
    setOpenState((prev) => ({ ...prev, [name]: isOpen }));
    if (isOpen) {
      setFront(name);
    }
  }, []);

  return (
    <FloatingWindowContext.Provider
      value={{ open, setOpen, front, bringToFront: setFront }}
    >
      {children}
    </FloatingWindowContext.Provider>
  );
}

export function useFloatingWindow(name: FloatingWindowName) {
  const context = useContext(FloatingWindowContext);
  if (context === undefined) {
    throw new Error(
      "useFloatingWindow must be used within a FloatingWindowProvider"
    );
  }
  const { open, setOpen, front, bringToFront } = context;
  const isOpen = !!open[name];
  return {
    isOpen,
    setIsOpen: (value: boolean) => setOpen(name, value),
    toggle: () => setOpen(name, !isOpen),
    isFront: front === name,
    bringToFront: () => bringToFront(name),
  };
}
