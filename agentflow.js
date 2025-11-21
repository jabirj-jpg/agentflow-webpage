(() => {
    // === Editable settings ===
    const MODEL = 'gpt-4o-mini';
    const PROXY_URL = '/api/agentflow';

    // Update these prompt templates with your preferred phrasing.
    const promptTemplates = {
        mainGoal: [
            'MAIN INSTRUCTION: Define AgentFlow’s core guidance (role, goal, persona) tailored to the provided industry and main goal.',
            'Deliver concise bullets for:',
            '- Role & Goal: What AgentFlow must do for this industry/use case (e.g., “You are a customer support agent for <industry> helping with <goal>”).',
            '- Interaction type: Channel/format (e.g., chatbot, outbound campaign, onboarding, survey).',
            '- KPI/outcome: One or two measurable targets (e.g., lead conversion %, response rate, setup completion).',
            '- Persona: Tone/personality (e.g., “Friendly, professional, patient; sparing use of emojis”).',
            'Ground everything in the user’s industry + main goal; avoid generic language; total under ~80 words.'
        ].join('\n'),
        leadCriteria: [
            'LEAD SCORING (SALES ONLY): Generate multiple weighted criteria applicable to sales.',
            'Format each criterion exactly as:',
            'Lead score weight: {{0-100%}}',
            'Criteria: {{generated output}}',
            'All lead score weights must sum to 100% in total.',
            'Base the criteria on the user input and industry context.'
        ].join('\n'),
        guardrails: [
            'GUARDRAILS: Tailor to the provided guardrails and industry (especially regulated).',
            'For each guardrail, use the format:',
            'Observe for: {{generated situation}}',
            'How to react: {{how an AI Agent should react to the situation}}',
            'Provide multiple guardrails if appropriate'
        ].join('\n'),
        exitConditions: [
            'EXIT CONDITIONS: Define how and when the AI Agent should end or hand over to a human.',
            'For each condition, use the format:',
            'Condition name: {{generated name}}',
            'Condition type: strictly one of ("exit based on message signal", "exit when media file is encountered", "exit based on lead score - only for sales use case")',
            'Exit condition: {{generated scenario to exit}}',
            'Provide multiple exit conditions if appropriate.'
        ].join('\n'),
        tone: [
            'MESSAGE TONE OF VOICE: Use the user-provided tone, industry, and main goal to create guidance in this exact format:',
            '#Tone: {{tone guidance}}',
            '#Format: {{format guidance}}',
            '#Goal: {{message goal}}',
            '#Content: {{content boundaries}}'
        ].join('\n')
    };

    const form = document.getElementById('agentFlowForm');
    const outputs = {
        main: document.getElementById('output-main'),
        tone: document.getElementById('output-tone'),
        guardrails: document.getElementById('output-guardrails'),
        lead: document.getElementById('output-lead'),
        exit: document.getElementById('output-exit')
    };
    const leadToggle = document.getElementById('leadToggle');
    const leadInput = document.getElementById('leadScore');
    const leadWrapper = document.getElementById('leadTextWrapper');
    const copyButtons = Array.from(document.querySelectorAll('.copy-btn'));
    const submitButton = form?.querySelector('button[type="submit"]');

    if (!form || Object.values(outputs).some(el => !el) || !leadToggle || !leadInput || !leadWrapper) {
        console.error('AgentFlow form or output containers not found.');
        return;
    }

    syncLeadState();
    leadToggle.addEventListener('change', syncLeadState);

    copyButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-target');
            const el = document.getElementById(targetId);
            if (!el) return;
            navigator.clipboard.writeText(el.textContent || '').then(() => {
                const original = btn.textContent;
                btn.textContent = 'Copied!';
                setTimeout(() => (btn.textContent = original), 1200);
            });
        });
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();

        const formData = new FormData(form);
        const payload = {
            industry: formData.get('industry')?.toString().trim() || '',
            mainGoal: formData.get('mainGoal')?.toString().trim() || '',
            guardrails: formData.get('guardrails')?.toString().trim() || '',
            toneOfVoice: formData.get('toneOfVoice')?.toString().trim() || '',
            leadScore: leadToggle.checked ? formData.get('leadScore')?.toString().trim() || '' : '',
            leadEnabled: leadToggle.checked,
            exitConditions: formData.get('exitConditions')?.toString().trim() || ''
        };

        const requestBody = {
            model: MODEL,
            messages: [
                {
                    role: 'system',
                    content: [
                        `You are composing an AgentFlow spec for ${payload.industry || 'an unspecified industry'}.`,
                        `Adopt this tone: ${payload.toneOfVoice || 'neutral'}.`,
                        `Guardrails: ${payload.guardrails || 'None provided.'}`
                    ].join('\n')
                },
                {
                    role: 'user',
                    content: buildUserPrompt(payload)
                }
            ],
            temperature: 0.2
        };

        setLoading(true);
        try {
            const content = await callProxy(requestBody);
            renderOutputs(content);
        } catch (error) {
            renderError(error.message);
        } finally {
            setLoading(false);
        }
    });

    function buildUserPrompt(data) {
        return [
            `${promptTemplates.mainGoal}\n${data.mainGoal || 'N/A'}`,
            data.leadEnabled
                ? `${promptTemplates.leadCriteria}\n${data.leadScore || 'N/A'}`
                : 'Hot lead criteria: disabled by user toggle.',
            `${promptTemplates.guardrails}\n${data.guardrails || 'N/A'}`,
            `${promptTemplates.exitConditions}\n${data.exitConditions || 'N/A'}`,
            `Industry context: ${data.industry || 'N/A'}`,
            `Preferred tone of voice: ${data.toneOfVoice || 'N/A'}`,
            promptTemplates.tone,
            `Respond ONLY as JSON with keys: main_instruction, message_tone, guardrails, hot_lead_criteria, exit_conditions. No markdown, no prose outside JSON.`
        ].join('\n\n');
    }

    async function callProxy(body) {
        const response = await fetch(PROXY_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            throw new Error(`OpenAI API error (${response.status}): ${errorText || response.statusText}`);
        }

        const data = await response.json();
        const content = data.content || data.choices?.[0]?.message?.content || '';
        if (typeof content === 'string') return content;
        return JSON.stringify(content);
    }

    function setLoading(isLoading) {
        if (!submitButton) return;
        submitButton.disabled = isLoading;
        submitButton.textContent = isLoading ? 'Generating…' : 'Submit';
        if (isLoading) {
            Object.values(outputs).forEach(el => {
                el.classList.add('muted');
                el.textContent = 'Generating response…';
            });
        }
    }

    function renderOutputs(rawContent) {
        const parsed = parseJsonSafe(rawContent);
        const main = formatValue(parsed?.main_instruction) || rawContent || 'No content returned.';
        const tone = formatValue(parsed?.message_tone) || 'No tone guidance returned.';
        const guardrails = formatValue(parsed?.guardrails) || 'No guardrails returned.';
        const lead = leadToggle.checked
            ? formatValue(parsed?.hot_lead_criteria) || 'No lead criteria returned.'
            : 'Lead criteria disabled.';
        const exit = formatValue(parsed?.exit_conditions) || 'No exit conditions returned.';

        outputs.main.classList.remove('muted');
        outputs.tone.classList.remove('muted');
        outputs.guardrails.classList.remove('muted');
        outputs.lead.classList.remove('muted');
        outputs.exit.classList.remove('muted');

        outputs.main.textContent = main;
        outputs.tone.textContent = tone;
        outputs.guardrails.textContent = guardrails;
        outputs.lead.textContent = lead;
        outputs.exit.textContent = exit;
    }

    function renderError(message) {
        Object.values(outputs).forEach(el => {
            el.classList.remove('muted');
            el.textContent = `Error: ${message}`;
        });
    }

    function parseJsonSafe(content) {
        if (!content) return null;
        try {
            return JSON.parse(content);
        } catch {
            return null;
        }
    }

    function syncLeadState() {
        const enabled = leadToggle.checked;
        leadWrapper.classList.toggle('hidden', !enabled);
        leadInput.disabled = !enabled;
        if (!enabled) {
            leadInput.value = '';
        }
    }

    function formatValue(value) {
        if (value === null || value === undefined) return '';
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }
        if (Array.isArray(value)) {
            return value.map(item => formatValue(item)).filter(Boolean).join('\n\n');
        }
        if (typeof value === 'object') {
            const entries = Object.entries(value)
                .map(([key, val]) => `${key}: ${formatValue(val)}`)
                .filter(Boolean);
            return entries.join('\n');
        }
        return JSON.stringify(value, null, 2);
    }
})();
