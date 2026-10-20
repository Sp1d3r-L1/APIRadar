import mongoose, { Schema } from 'mongoose';

interface ISecretReviewControl {
  _id: string;
  active: boolean;
  startedAt?: Date | null;
  updatedAt: Date;
}

const schema = new Schema<ISecretReviewControl>({
  _id: { type: String, required: true },
  active: { type: Boolean, default: false },
  startedAt: { type: Date, default: null }
}, { timestamps: { createdAt: false, updatedAt: true }, versionKey: false });

export const SecretReviewControl = mongoose.model<ISecretReviewControl>('SecretReviewControl', schema);
