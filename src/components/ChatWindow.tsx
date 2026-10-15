import { useEffect, useRef, useState } from "react";
import { Box, Close, Flex, IconButton, Text } from "theme-ui";

import OpenInNewIcon from "../icons/OpenInNewIcon";
import { chatUrl, useChatPanel } from "../contexts/ChatPanelContext";

type Rect = { x: number; y: number; width: number; height: number };
// Which edges a pointer drag moves; the title bar moves all of them
type Edges = {
  left?: boolean;
  right?: boolean;
  top?: boolean;
  bottom?: boolean;
};

const RECT_STORAGE_KEY = "chatWindow.rect";
const PARTY_WIDTH = 112;
const MARGIN = 8;
const MIN_WIDTH = 280;
const MIN_HEIGHT = 240;
const HEADER_HEIGHT = 36;
// Keep the title text on screen so the window can always be dragged back
const MIN_VISIBLE = 120;

function defaultRect(): Rect {
  return {
    x: PARTY_WIDTH,
    y: MARGIN,
    width: Math.min(440, window.innerWidth - PARTY_WIDTH - MARGIN),
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

function loadRect(): Rect {
  try {
    const stored = JSON.parse(localStorage.getItem(RECT_STORAGE_KEY) || "null");
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

/**
 * Floating chat window over the map that can be moved and resized.
 * The iframe stays mounted once opened so hiding the window keeps the chat state.
 */
function ChatWindow() {
  const { isOpen, setIsOpen } = useChatPanel();
  const [rect, setRect] = useState(loadRect);
  const [hasOpened, setHasOpened] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
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
    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, []);

  useEffect(() => {
    if (isDragging) {
      return;
    }
    try {
      localStorage.setItem(RECT_STORAGE_KEY, JSON.stringify(rect));
    } catch {}
  }, [rect, isDragging]);

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

  if (!chatUrl || !hasOpened) {
    return null;
  }

  return (
    <Flex
      bg="background"
      // Flex's own display rule wins over sx, so hide with an inline style
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        ...(isOpen ? {} : { display: "none" }),
      }}
      sx={{
        position: "fixed",
        zIndex: 50,
        flexDirection: "column",
        borderRadius: "4px",
        border: "1px solid",
        borderColor: "border",
        boxShadow: "0 4px 24px rgba(0, 0, 0, 0.5)",
      }}
    >
      <Flex
        px={2}
        aria-label="Move Chat"
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
          Chat
        </Text>
        <Flex
          sx={{ alignItems: "center", cursor: "default" }}
          // Buttons should not start a window drag
          onPointerDown={(event) => event.stopPropagation()}
        >
          <IconButton
            aria-label="Open Chat in New Window"
            title="Open Chat in New Window"
            onClick={() =>
              window.open(chatUrl, "owlbear-chat", "popup,width=480,height=760")
            }
          >
            <OpenInNewIcon />
          </IconButton>
          <Close
            aria-label="Hide Chat"
            title="Hide Chat"
            onClick={() => setIsOpen(false)}
          />
        </Flex>
      </Flex>
      <Box sx={{ position: "relative", flexGrow: 1 }}>
        <iframe
          src={chatUrl}
          title="Chat"
          allow="clipboard-read; clipboard-write; autoplay; fullscreen"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            border: "none",
            background: "white",
          }}
        />
        {/* Keep pointer events away from the iframe while moving or resizing */}
        {isDragging && <Box sx={{ position: "absolute", inset: 0 }} />}
      </Box>
      {resizeHandles.map(({ name, edges, sx }) => (
        <Box
          key={name}
          aria-label={`Resize Chat ${name}`}
          onPointerDown={startDrag(edges)}
          {...dragHandlers}
          sx={{ position: "absolute", zIndex: 1, touchAction: "none", ...sx }}
        />
      ))}
    </Flex>
  );
}

export default ChatWindow;
