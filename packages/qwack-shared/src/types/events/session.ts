export interface SessionStatusChangePayload {
  status: string;
}

export interface SessionHostChangePayload {
  newHostId: string;
}

export interface SessionSettingsChangePayload {
  settings: Record<string, unknown>;
}

export interface SessionContextSnapshotPayload {
  snapshot: string;
  timestamp: number;
}
