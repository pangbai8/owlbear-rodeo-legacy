import Konva from "konva";
import { useEffect, useRef, useState } from "react";
import { Group, Rect, Text } from "react-konva";

import { conditionBadge } from "../../helpers/pf2Conditions";
import { TokenState } from "../../types/TokenState";

type TokenConditionsProps = {
  tokenState: TokenState;
  width: number;
  height: number;
};

/** PF2 conditions as a small badge above the token ("惊惧1 · 倒地") */
function TokenConditions({ tokenState, width }: TokenConditionsProps) {
  const text = conditionBadge(tokenState.conditions || []);
  // Sized by the token (a 1×1 token gets a readable but small badge)
  const fontSize = Math.max(width / tokenState.size / 6, 6) * Math.min(tokenState.size, 2);
  const textRef = useRef<Konva.Text>(null);
  const [textWidth, setTextWidth] = useState(0);
  useEffect(() => {
    setTextWidth(textRef.current?.getTextWidth() || 0);
  }, [text, fontSize]);

  if (!text) return null;
  const padX = fontSize * 0.5;
  const padY = fontSize * 0.25;
  const boxHeight = fontSize + padY * 2;
  const boxWidth = textWidth + padX * 2;
  const top = -boxHeight - fontSize * 0.2;
  return (
    <Group>
      <Rect
        x={width / 2 - boxWidth / 2}
        y={top}
        width={boxWidth}
        height={boxHeight}
        fill="hsla(350, 55%, 30%, 0.88)"
        cornerRadius={boxHeight / 2}
        hitFunc={() => {}}
      />
      <Text
        ref={textRef}
        x={width / 2 - textWidth / 2}
        y={top + padY}
        text={text}
        fontSize={fontSize}
        lineHeight={1}
        fill="white"
        wrap="none"
        hitFunc={() => {}}
      />
    </Group>
  );
}

export default TokenConditions;
