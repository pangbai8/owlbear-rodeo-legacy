import { Box, Flex, Text } from "theme-ui";

import {
  PF2_CONDITIONS,
  conditionValue,
  parseCondition,
  setCondition,
} from "../../helpers/pf2Conditions";
import { findPf2 } from "../../helpers/pf2";
import { openFiveECard } from "../../helpers/fiveETools";

type Pf2ConditionPickerProps = {
  conditions: string[];
  onChange: (conditions: string[]) => void;
};

/** The token menu's PF2 conditions (in place of the color rings) */
function Pf2ConditionPicker({ conditions, onChange }: Pf2ConditionPickerProps) {
  function lookUp(name: string) {
    findPf2(name, "condition")
      .then((result) => result && openFiveECard(result))
      .catch(() => {});
  }

  return (
    <Box>
      {conditions.length > 0 && (
        <Flex sx={{ flexWrap: "wrap", gap: "4px", mb: 1 }}>
          {conditions.map((text) => {
            const { name, value } = parseCondition(text);
            return (
              <Flex
                key={name}
                sx={{
                  alignItems: "center",
                  bg: "hsla(350, 55%, 30%, 0.9)",
                  borderRadius: "10px",
                  px: 1,
                  fontSize: 0,
                  color: "white",
                }}
              >
                <Text
                  as="button"
                  onClick={() => lookUp(name)}
                  title={`查看「${name}」的规则`}
                  sx={chipButton}
                >
                  {name}
                </Text>
                {value !== null && (
                  <>
                    <Text
                      as="button"
                      onClick={() => onChange(setCondition(conditions, name, value - 1))}
                      aria-label={`${name} 减 1`}
                      sx={chipButton}
                    >
                      −
                    </Text>
                    <b>{value}</b>
                    <Text
                      as="button"
                      onClick={() => onChange(setCondition(conditions, name, Math.min(9, value + 1)))}
                      aria-label={`${name} 加 1`}
                      sx={chipButton}
                    >
                      ＋
                    </Text>
                  </>
                )}
                <Text
                  as="button"
                  onClick={() => onChange(setCondition(conditions, name, null))}
                  aria-label={`移除${name}`}
                  sx={chipButton}
                >
                  ×
                </Text>
              </Flex>
            );
          })}
        </Flex>
      )}
      <Flex
        sx={{ flexWrap: "wrap", gap: "3px", maxHeight: "132px", overflowY: "auto" }}
      >
        {PF2_CONDITIONS.filter(([name]) => conditionValue(conditions, name) === null).map(
          ([name, valued, summary]) => (
            <Text
              key={name}
              as="button"
              title={summary}
              onClick={() => onChange(setCondition(conditions, name, valued ? 1 : 0))}
              sx={{
                fontSize: 0,
                px: "6px",
                py: "1px",
                borderRadius: "10px",
                border: "1px solid",
                borderColor: "border",
                bg: "transparent",
                color: "text",
                cursor: "pointer",
              }}
            >
              {name}
            </Text>
          )
        )}
      </Flex>
    </Box>
  );
}

const chipButton = {
  bg: "transparent",
  border: "none",
  color: "white",
  cursor: "pointer",
  font: "inherit",
  px: "3px",
  py: 0,
};

export default Pf2ConditionPicker;
