import { Agent } from 'agents';
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from './types';
import { VOICE_CONTRACT } from './shared/voice-contract';
import type { VoiceAuditResult } from './voice-auditor';
import type { StructureAuditResult } from './structure-editor';
import type { FactCheckResult } from './fact-checker';

export interface IntegrationResult {
  revisedMdx: string;
  changesSummary: string[];
}

interface IntegratorState {
  revisionCount: number;
}

/**
 * IntegratorAgent — takes audit feedback from all three gates,
 * synthesises it, and revises the draft. Submits back for re-audit.
 * Max 3 revision passes before escalation.
 */
export class IntegratorAgent extends Agent<Env, IntegratorState> {
  initialState: IntegratorState = { revisionCount: 0 };

  async revise(
    mdx: string,
    voiceResult: VoiceAuditResult,
    structureResult: StructureAuditResult,
    factResult: FactCheckResult,
  ): Promise<IntegrationResult> {
    const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });

    // Collect all feedback
    const feedback: string[] = [];

    if (!voiceResult.passed) {
      feedback.push('## Voice issues (score: ' + voiceResult.score + '/100)');
      voiceResult.violations.forEach((v) => feedback.push(`- VIOLATION: ${v}`));
      voiceResult.suggestions.forEach((s) => feedback.push(`- FIX: ${s}`));
    }

    if (!structureResult.passed) {
      feedback.push('## Structure issues');
      structureResult.issues.forEach((i) => feedback.push(`- ISSUE: ${i}`));
      structureResult.suggestions.forEach((s) => feedback.push(`- FIX: ${s}`));
    }

    if (!factResult.passed) {
      feedback.push('## Fact issues');
      factResult.claims
        .filter((c) => c.status !== 'verified')
        .forEach((c) => feedback.push(`- ${c.status.toUpperCase()}: "${c.claim}" — ${c.note}`));
    }

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 8000,
      system: `You are the Integrator for Zeemish. Your job is to revise a lesson draft based on feedback from three auditors (voice, structure, fact-checking).

${VOICE_CONTRACT}

RULES:
- Fix every flagged issue
- Do NOT introduce new problems while fixing old ones
- Keep the same overall structure and topic — don't rewrite from scratch
- Return the COMPLETE revised MDX file, ready to save
- Start with the --- frontmatter delimiter, nothing else before or after`,
      messages: [
        {
          role: 'user',
          content: `## Original draft:\n\n${mdx}\n\n## Feedback from auditors:\n\n${feedback.join('\n')}`,
        },
      ],
    });

    const revisedMdx = response.content[0].type === 'text' ? response.content[0].text : mdx;

    this.setState({ revisionCount: this.state.revisionCount + 1 });

    return {
      revisedMdx,
      changesSummary: feedback,
    };
  }
}
