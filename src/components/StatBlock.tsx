// Building blocks shared by the rules cards (PF2, 3R): stat tiles, a
// two-column field table and section titles, so the stat blocks read alike.

import React from "react";
import { Box, Text } from "theme-ui";

/** A boxed number with its name above (AC, HP, initiative…) */
export function Tile({
  label,
  title,
  children,
}: {
  label: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <Box
      title={title}
      sx={{
        border: "1px solid",
        borderColor: "border",
        borderRadius: "6px",
        px: 1,
        py: "4px",
        textAlign: "center",
        minWidth: 0,
      }}
    >
      <Text sx={{ display: "block", fontSize: 0, color: "gray" }}>{label}</Text>
      {children}
    </Box>
  );
}

/** A row of tiles */
export function TileRow({
  children,
  columns = 4,
}: {
  children: React.ReactNode;
  columns?: number;
}) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: 1,
        mt: 2,
      }}
    >
      {children}
    </Box>
  );
}

/** Fields as a two-column table: names on the left, values on the right */
export function FieldGrid({
  rows,
  dim = false,
}: {
  rows: [string, React.ReactNode][];
  dim?: boolean;
}) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "max-content 1fr",
        columnGap: 3,
        rowGap: "2px",
        opacity: dim ? 0.75 : 1,
      }}
    >
      {rows.map(([label, value]) => (
        <React.Fragment key={label}>
          <Text
            sx={{
              fontSize: 0,
              fontWeight: "bold",
              color: "gray",
              pt: "2px",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </Text>
          <Box>{value}</Box>
        </React.Fragment>
      ))}
    </Box>
  );
}

/** A section of the card: a rule, a small colored title, then its content */
export function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <Box sx={{ borderTop: "1px solid", borderColor: "border", mt: 2, pt: 2 }}>
      {title && <Text sx={sectionTitle}>{title}</Text>}
      {children}
    </Box>
  );
}

export const tileValue = {
  display: "block",
  fontSize: 3,
  fontWeight: "bold",
  lineHeight: 1.2,
};
export const tileNote = {
  display: "block",
  fontSize: 0,
  color: "gray",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap" as const,
};
export const chipBox = {
  border: "1px solid",
  borderColor: "border",
  borderRadius: "4px",
  px: 2,
  fontSize: 1,
};
export const sectionTitle = {
  display: "block",
  fontSize: 0,
  fontWeight: "bold",
  color: "primary",
  letterSpacing: "0.1em",
  mb: 1,
};
