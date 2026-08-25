"use client";

import { useEffect } from "react";

import {
  markPolicyAcknowledgementViewedAction,
} from "./actions";

export function PolicyViewTracker({
  acknowledgementId,
}: {
  acknowledgementId: string;
}) {
  useEffect(() => {
    void markPolicyAcknowledgementViewedAction(
      acknowledgementId
    );
  }, [acknowledgementId]);

  return null;
}