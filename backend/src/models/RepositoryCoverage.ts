import mongoose, { Document, Schema } from 'mongoose';

export interface IRepositoryCoverage extends Document {
  repository: string;
  discoveredBySearch: boolean;
  discoveredByEvents: boolean;
  installed: boolean;
  lastScannedAt?: Date;
  branchesSeen: number;
  filesSeen: number;
  skippedBlobs: number;
  skippedLarge: number;
  skippedBinary: number;
  truncatedTrees: number;
  snapshotHeads: Array<{ name: string; sha: string }>;
  cursorBranch: number;
  cursorFile: number;
  snapshotCompleteAt?: Date;
  historyHeads: Array<{ name: string; sha: string }>;
  historyCursorBranch: number;
  historyCursorPage: number;
  historyCursorIndex: number;
  commitsSeen: number;
  missingPatches: number;
  historyCompleteAt?: Date;
  historyError?: string;
  alertsPermission: 'ok' | 'denied' | 'unavailable' | 'error' | 'pending' | 'not-applicable';
  error?: string;
}

const schema = new Schema<IRepositoryCoverage>({
  repository: { type: String, required: true, unique: true },
  discoveredBySearch: { type: Boolean, default: false },
  discoveredByEvents: { type: Boolean, default: false },
  installed: { type: Boolean, default: false },
  lastScannedAt: { type: Date, index: true },
  branchesSeen: { type: Number, default: 0 },
  filesSeen: { type: Number, default: 0 },
  skippedBlobs: { type: Number, default: 0 },
  skippedLarge: { type: Number, default: 0 },
  skippedBinary: { type: Number, default: 0 },
  truncatedTrees: { type: Number, default: 0 },
  snapshotHeads: [{ name: String, sha: String }],
  cursorBranch: { type: Number, default: 0 },
  cursorFile: { type: Number, default: 0 },
  snapshotCompleteAt: Date,
  historyHeads: [{ name: String, sha: String }],
  historyCursorBranch: { type: Number, default: 0 },
  historyCursorPage: { type: Number, default: 1 },
  historyCursorIndex: { type: Number, default: 0 },
  commitsSeen: { type: Number, default: 0 },
  missingPatches: { type: Number, default: 0 },
  historyCompleteAt: Date,
  historyError: String,
  alertsPermission: { type: String, default: 'pending' },
  error: String
}, { versionKey: false });

schema.index({ lastScannedAt: 1, _id: 1 });

export const RepositoryCoverage = mongoose.model<IRepositoryCoverage>('RepositoryCoverage', schema);
