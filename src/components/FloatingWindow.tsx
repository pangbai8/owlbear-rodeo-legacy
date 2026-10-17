import React, { useEffect, useRef, useState } from "react";
import { Box, Close, Flex, Text } from "theme-ui";

import {
  FloatingWindowName,
  useFloatingWindow,
} from "../contexts/FloatingWindowContext";

export type Rect = { x: number; y: number; width: number; height: number };
// Which edges a pointer drag moves; the title bar moves all of them
type Edges = {
  left?: boolean;
  right?: boolean;
  top?: boolean;
  bottom?: boolean;
};

const PARTY_WIDTH = 112;
const MARGIN = 8;
const MIN_WIDTH = 280;
const MIN_HEIGHT = 240;
const HEADER_HEIGHT = 36;
// Keep the title text on screen so the window can always be dragged back
const MIN_VISIBLE = 120;

/** Default placement: right of the party sidebar, full height */
export function besidePartyRect(offsetX: number, width: number): Rect {
  const x = PARTY_WIDTH + offsetX;
  return {
    x,
    y: MARGIN,
    width: Math.min(width, window.innerWidth - x - MARGIN),
    height: window.innerHeight - MARGIN * 2,
  };
}

function clampRect({ x, y, width, height }: Rect): Rect {
  const maxWidth = Math.max(MIN_WIDTH, window.innerWidth);
  const maxHeight = Math.max(MIN_HEIGHT, window.innerHeight);
  width = Math.min(Math.max(width, MIN_WIDTH), maxWidth);
  height = Math.min(Math.max(height, MIN_HEIGHT), maxHeight);
  x = Math.min(Math.max(x, 0), window.innerWidth - MIN_VISIBLE);
  // Keep the whole window vertically on screen so every resize handle is reachable
  y = Math.min(Math.max(y, 0), Math.max(0, window.innerHeight - height));
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function loadRect(storageKey: string, defaultRect: () => Rect): Rect {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (
      stored &&
      ["x", "y", "width", "height"].every((key) => Number.isFinite(stored[key]))
    ) {
      return clampRect(stored);
    }
  } catch {}
  return clampRect(defaultRect());
}

function applyDrag(start: Rect, edges: Edges, dx: number, dy: number): Rect {
  let { x, y, width, height } = start;
  const move = edges.left && edges.right && edges.top && edges.bottom;
  if (move) {
    return clampRect({ x: x + dx, y: y + dy, width, height });
  }
  if (edges.left) {
    // Keep the right edge fixed while the left edge moves
    const newWidth = Math.max(width - dx, MIN_WIDTH);
    x += width - newWidth;
    width = newWidth;
  }
  if (edges.right) {
    width = Math.max(width + dx, MIN_WIDTH);
  }
  if (edges.top) {
    const newHeight = Math.max(height - dy, MIN_HEIGHT);
    y += height - newHeight;
    height = newHeight;
  }
  if (edges.bottom) {
    height = Math.max(height + dy, MIN_HEIGHT);
  }
  return clampRect({ x, y, width, height });
}

// theme-ui maps bare numbers in sx to its scales, so offsets use px strings
const resizeHandles: { name: string; edges: Edges; sx: object }[] = [
  {
    name: "n",
    edges: { top: true },
    sx: {
      top: "-3px",
      left: "8px",
      right: "8px",
      height: "6px",
      cursor: "ns-resize",
    },
  },
  {
    name: "s",
    edges: { bottom: true },
    sx: {
      bottom: "-3px",
      left: "8px",
      right: "8px",
      height: "6px",
      cursor: "ns-resize",
    },
  },
  {
    name: "w",
    edges: { left: true },
    sx: {
      left: "-3px",
      top: "8px",
      bottom: "8px",
      width: "6px",
      cursor: "ew-resize",
    },
  },
  {
    name: "e",
    edges: { right: true },
    sx: {
      right: "-3px",
      top: "8px",
      bottom: "8px",
      width: "6px",
      cursor: "ew-resize",
    },
  },
  {
    name: "nw",
    edges: { top: true, left: true },
    sx: {
      top: "-3px",
      left: "-3px",
      width: "12px",
      height: "12px",
      cursor: "nwse-resize",
    },
  },
  {
    name: "ne",
    edges: { top: true, right: true },
    sx: {
      top: "-3px",
      right: "-3px",
      width: "12px",
      height: "12px",
      cursor: "nesw-resize",
    },
  },
  {
    name: "sw",
    edges: { bottom: true, left: true },
    sx: {
      bottom: "-3px",
      left: "-3px",
      width: "12px",
      height: "12px",
      cursor: "nesw-resize",
    },
  },
  {
    name: "se",
    edges: { bottom: true, right: true },
    sx: {
      bottom: "-3px",
      right: "-3px",
      width: "12px",
      height: "12px",
      cursor: "nwse-resize",
    },
  },
];

type FloatingWindowProps = {
  name: FloatingWindowName;
  title: string;
  /** localStorage key for the remembered position and size */
  storageKey: string;
  defaultRect: () => Rect;
  /** Extra buttons shown in the title bar before the close button */
  headerActions?: React.ReactNode;
  /** Load the contents (hidden) before the window is first opened */
  preload?: boolean;
  children: React.ReactNode;
};

/**
 * Window floating over the map that can be moved and resized.
 * Children mount on first open and stay mounted while hidden, so an embedded
 * iframe keeps its state.
 */
function FloatingWindow({
  name,
  title,
  storageKey,
  defaultRect,
  headerActions,
  preload = false,
  children,
}: FloatingWindowProps) {
  const { isOpen, setIsOpen, isFront, bringToFront } = useFloatingWindow(name);
  const [rect, setRect] = useState(() => loadRect(storageKey, defaultRect));
  const [hasOpened, setHasOpened] = useState(preload);
  useEffect(() => {
    if (preload) setHasOpened(true);
  }, [preload]);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const bringToFrontRef = useRef(bringToFront);
  bringToFrontRef.current = bringToFront;
  const dragRef = useRef<{
    edges: Edges;
    startX: number;
    startY: number;
    startRect: Rect;
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setHasOpened(true);
    }
  }, [isOpen]);

  useEffect(() => {
    function handleWindowResize() {
      setRect((prev) => clampRect(prev));
    }
    // Clicks inside an iframe never reach this document, but focusing the
    // iframe blurs the page, which is enough to raise the window it sits in
    function handleBlur() {
      setTimeout(() => {
        const active = document.activeElement;
        if (active && containerRef.current?.contains(active)) {
          bringToFrontRef.current();
        }
      });
    }
    window.addEventListener("resize", handleWindowResize);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  useEffect(() => {
    if (isDragging) {
      return;
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(rect));
    } catch {}
  }, [rect, isDragging, storageKey]);

  function startDrag(edges: Edges) {
    return (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) {
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        edges,
        startX: event.clientX,
        startY: event.clientY,
        startRect: rect,
      };
      setIsDragging(true);
    };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    setRect(
      applyDrag(
        drag.startRect,
        drag.edges,
        event.clientX - drag.startX,
        event.clientY - drag.startY
      )
    );
  }

  function endDrag(event: React.PointerEvent<HTMLElement>) {
    if (!dragRef.current) {
      return;
    }
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    setIsDragging(false);
  }

  const dragHandlers = {
    onPointerMove: handlePointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  };

  if (!hasOpened) {
    return null;
  }

  return (
    <Flex
      ref={containerRef}
      bg="background"
      onPointerDownCapture={bringToFront}
      // Flex's own display rule wins over sx, so hide with an inline style
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        zIndex: isFront ? 51 : 50,
        ...(isOpen ? {} : { display: "none" }),
      }}
      sx={{
        position: "fixed",
        flexDirection: "column",
        borderRadius: "4px",
        border: "1px solid",
        borderColor: "border",
        boxShadow: "0 4px 24px rgba(0, 0, 0, 0.5)",
      }}
    >
      <Flex
        px={2}
        aria-label={`Move ${title}`}
        onPointerDown={startDrag({
          left: true,
          right: true,
          top: true,
          bottom: true,
        })}
        {...dragHandlers}
        sx={{
          alignItems: "center",
          justifyContent: "space-between",
          height: `${HEADER_HEIGHT}px`,
          minHeight: `${HEADER_HEIGHT}px`,
          cursor: isDragging ? "grabbing" : "grab",
          touchAction: "none",
          userSelect: "none",
        }}
      >
        <Text variant="heading" as="h1">
          {title}
        </Text>
        <Flex
          sx={{ alignItems: "center", cursor: "default" }}
          // Buttons should not start a window drag
          onPointerDown={(event) => event.stopPropagation()}
        >
          {headerActions}
          <Close
            aria-label={`Hide ${title}`}
            title={`Hide ${title}`}
            onClick={() => setIsOpen(false)}
          />
        </Flex>
      </Flex>
      <Flex sx={{ position: "relative", flexGrow: 1, flexDirection: "column" }}>
        {children}
        {/* Keep pointer events away from iframes while moving or resizing */}
        {isDragging && <Box sx={{ position: "absolute", inset: 0 }} />}
      </Flex>
      {resizeHandles.map(({ name: handle, edges, sx }) => (
        <Box
          key={handle}
          aria-label={`Resize ${title} ${handle}`}
          onPointerDown={startDrag(edges)}
          {...dragHandlers}
          sx={{ position: "absolute", zIndex: 1, touchAction: "none", ...sx }}
        />
      ))}
    </Flex>
  );
}

export default FloatingWindow;
