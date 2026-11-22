"use client";
// The club's landing-fee table for the forms that prefill a fee (post-flight,
// add flight). It lives in the Airport table (Club settings › Airports), so a
// form reads it once as it opens; until it lands — or when it can't — the table
// is empty and the fee box simply opens blank, which is the honest default for
// a figure the pilot can always type.
import { useEffect, useState } from "react";
import { fetchJsonArray } from "@/lib/api";
import { feeTableFrom, type FeeTable } from "@/lib/landingFees";

/** Airport → fee in cents, as Club settings has it. Empty until fetched. */
export function useLandingFees(): FeeTable {
  const [table, setTable] = useState<FeeTable>({});
  useEffect(() => {
    let live = true;
    fetchJsonArray<{ code: string; landingFeeCents: number | null }>("/api/airports").then(
      (rows) => {
        if (live) setTable(feeTableFrom(rows));
      }
    );
    return () => {
      live = false;
    };
  }, []);
  return table;
}
