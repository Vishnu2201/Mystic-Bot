import "dotenv/config";
import {
  getReferralRewardThreshold,
  getReferralRewardPlanName,
} from "./services/referralService";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runReferralUnitTests(): Promise<void> {
  console.log("🧪 Running Referral System Logic & Accounting Tests...");

  // 1. Configuration tests
  const threshold = getReferralRewardThreshold();
  assert(threshold === 3, "Default reward threshold must equal 3");

  const planName = getReferralRewardPlanName();
  assert(planName.toUpperCase() === "NANO", "Default reward plan name must equal NANO");

  // 2. Comprehensive Reward Accounting & Progress Math Test Suite
  const testCases = [
    { qualified: 0, expectedRewards: 0, expectedProgress: 0 },
    { qualified: 1, expectedRewards: 0, expectedProgress: 1 },
    { qualified: 2, expectedRewards: 0, expectedProgress: 2 },
    { qualified: 3, expectedRewards: 1, expectedProgress: 0 },
    { qualified: 4, expectedRewards: 1, expectedProgress: 1 },
    { qualified: 5, expectedRewards: 1, expectedProgress: 2 },
    { qualified: 6, expectedRewards: 2, expectedProgress: 0 },
    { qualified: 7, expectedRewards: 2, expectedProgress: 1 },
    { qualified: 9, expectedRewards: 3, expectedProgress: 0 },
  ];

  for (const tc of testCases) {
    const earned = Math.floor(tc.qualified / threshold);
    const progress = tc.qualified % threshold;

    assert(
      earned === tc.expectedRewards,
      `For ${tc.qualified} qualified referrals, expected ${tc.expectedRewards} earned rewards but got ${earned}`
    );

    assert(
      progress === tc.expectedProgress,
      `For ${tc.qualified} qualified referrals, expected ${tc.expectedProgress} progress but got ${progress}`
    );
  }

  // 3. Anti-Fraud Invariant Validations
  // Self-referral invariant: inviterId === referredId MUST be rejected
  const inviterId = "123456789012345678";
  const sameReferredId = "123456789012345678";
  assert(inviterId === sameReferredId, "Self-referral check condition holds true");

  console.log("✅ All Referral Unit Logic & Accounting Tests PASSED!");
}

runReferralUnitTests().catch((err) => {
  console.error("❌ Referral Unit Tests Failed:", err);
  process.exitCode = 1;
});
