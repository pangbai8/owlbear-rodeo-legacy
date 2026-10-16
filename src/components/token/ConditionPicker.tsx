import { Box, Flex, Text } from "theme-ui";

import {
  DND4E_CONDITIONS,
  DND5E_CONDITIONS,
  DND5R_CONDITIONS,
  PF2_CONDITIONS,
  conditionMax,
  conditionValue,
  parseCondition,
  setCondition,
} from "../../helpers/conditions";
import { findPf2 } from "../../helpers/pf2";
import { findDnd4e } from "../../helpers/dnd4e";
import { lookupFiveE, openFiveECard } from "../../helpers/fiveETools";
import { RuleSystem } from "../../helpers/ruleSystem";

type ConditionPickerProps = {
  conditions: string[];
  onChange: (conditions: string[]) => void;
  system: RuleSystem;
};

/** The token menu's 5e or PF2 conditions (in place of the color rings) */
function ConditionPicker({ conditions, onChange, system }: ConditionPickerProps) {
  const table =
    system === "pf2"
      ? PF2_CONDITIONS
      : system === "4e"
      ? DND4E_CONDITIONS
      : system === "5r"
      ? DND5R_CONDITIONS
      : DND5E_CONDITIONS;
  const set = (name: string, value: number | null) =>
    onChange(setCondition(conditions, name, value, table));

  // A name opens its rules card in the search bar
  function lookUp(name: string) {
    // 4e: the wiki's condition table (one page for all)
    const find =
      system === "pf2" ? findPf2(name, "condition") : system === "4e" ? findDnd4e(name, "condition") : null;
    (find
      ? find.then((result) => result && openFiveECard(result))
      : lookupFiveE(name, "condition", system === "5r" ? "2024" : "2014")
    ).catch(() => {});
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
                      onClick={() => set(name, value - 1)}
                      aria-label={`${name} 减 1`}
                      sx={chipButton}
                    >
                      −
                    </Text>
                    <b>{value}</b>
                    <Text
                      as="button"
                      onClick={() => set(name, Math.min(conditionMax(name, table), value + 1))}
                      aria-label={`${name} 加 1`}
                      sx={chipButton}
                    >
                      ＋
                    </Text>
                  </>
                )}
                <Text
                  as="button"
                  onClick={() => set(name, null)}
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
        {table.filter(([name]) => conditionValue(conditions, name) === null).map(
          ([name, valued, summary]) => (
            <Text
              key={name}
              as="button"
              title={summary}
              onClick={() => set(name, valued ? 1 : 0)}
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

export default ConditionPicker;
