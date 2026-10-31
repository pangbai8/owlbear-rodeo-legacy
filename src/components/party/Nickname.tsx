import React from "react";
import { Text, Flex } from "theme-ui";

import Stream from "./Stream";
import DiceRolls from "./DiceRolls";
import { DiceRoll } from "../../types/Dice";

type NicknameProps = {
  nickname: string;
  stream?: MediaStream;
  diceRolls?: DiceRoll[];
  /** Shown right after the name, e.g. a button to edit it */
  action?: React.ReactNode;
};

function Nickname({ nickname, stream, diceRolls, action }: NicknameProps) {
  return (
    <Flex sx={{ flexDirection: "column" }}>
      <Flex sx={{ alignItems: "flex-start", gap: "2px" }}>
        <Text
          as="p"
          my={1}
          variant="body2"
          sx={{
            position: "relative",
            minWidth: 0,
          }}
        >
          {nickname}
        </Text>
        {action}
      </Flex>
      {stream && <Stream stream={stream} nickname={nickname} />}
      {diceRolls && <DiceRolls rolls={diceRolls} />}
    </Flex>
  );
}

export default Nickname;
