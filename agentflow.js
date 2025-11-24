(() => {
    // === Editable settings ===
    const MODEL = 'gpt-4o-mini';
    const PROXY_URL = '/api/agentflow';
    const DEBUG_LOG = true; // set to true to log API requests/responses to console

    const promptTemplates = {
        mainInstruction: [
            'MAIN INSTRUCTION: Define AgentFlow’s core guidance (role, goal, persona) tailored to the inferred industry and the provided main goal/use cases.',
            'Deliver concise bullets for:',
            '- Role & Goal: {{What AgentFlow must do for this use case.}}',
            '- Interaction type: Human conversation',
            '- KPI/outcome: {{One or two measurable targets.}}',
            '- Persona: {{Tone/personality (e.g., friendly, professional, patient; sparing use of emojis).}}',
            '- Writing tips: {{Objective, Background, Strategy, Response (keep brief).}}',
            'Ground everything in business name/summary + goal; avoid generic language; total under ~120 words.'
        ].join('\n'),
        tone: [
            'MESSAGE TONE OF VOICE: Infer from the business summary and goal/use cases. Use this format:',
            '#Tone: {{tone guidance}}',
            '#Format: {{format guidance}}',
            '#Goal: {{message goal}}',
            '#Content: {{content boundaries}}'
        ].join('\n'),
        intro: [
            'AI INTRO MESSAGE: 1-2 sentences to greet the user, state the agent role and value, aligned to the business name/summary and goal/use cases. Keep it warm, concise, and on-topic.'
        ].join('\n'),
        guardrails: [
            'GUARDRAILS: Based on the business context, industry (especially if regulated), and the goal/use cases, generate specific, context-adapted guardrails', 
            'you MUST always output at least these three universal guardrails, using the format "Observe for / How to react / ---" structure.',
            'However, you may reword Guardrail #1 and Guardrail #2 to match the business’s tone, terminology, and industry norms — without changing the underlying rule.',
            'Guardrail #1:(Competitors inquiries)',
            'Observe for: {{context-aware rewrite of competitor-related inquiries relevant to this business, include competitor names if applicable}}',
            'How to react: {{context-aware rewrite that keeps the rule: do not discuss competitors; redirect focus to our offering}}',
            '---',
            'Guardrail #2:(Pricing inquiries)',
            'Observe for: {{context-aware rewrite of pricing, quotation, costs, fees, or package inquiries}}',
            'How to react: {{context-aware rewrite that keeps the rule: do not quote pricing; direct user to human/sales for pricing details}}',
            '---',
            'Guardrail #3:(Out-of-scope inquiries)',
            'Observe for: {{inquiries outside the defined goal/use cases or business context}}',
            'How to react: {{politely inform the user that the inquiry is outside the agent’s scope and suggest contacting a human for further assistance}}'
        ].join('\n'),
        leadCriteria: [
            'LEAD SCORING (SALES ONLY): Generate multiple weighted criteria applicable to sales. If not sales-related, respond with "Not applicable".',
            'Format each criterion exactly as:',
            'Lead score weight: {{0-100%}}',
            'Criteria: {{generated output}}',
            'All lead score weights must sum to 100% in total.'
        ].join('\n'),
        exitConditions: [
            'EXIT CONDITIONS: Define how and when the AI Agent should end or hand over to a human.',
            'For each condition, use the format:',
            'Condition name: {{generated name}}',
            'Condition type: strictly one of ("exit based on message signal", "exit when media file is encountered", "exit based on lead score - only for sales use case")',
            'Exit condition: {{generated scenario to exit}}',
            'Provide multiple exit conditions if appropriate.'
        ].join('\n')
    };

    const form = document.getElementById('agentFlowForm');
    const outputs = {
        main: document.getElementById('output-main'),
        tone: document.getElementById('output-tone'),
        intro: document.getElementById('output-intro'),
        guardrails: document.getElementById('output-guardrails'),
        lead: document.getElementById('output-lead'),
        exit: document.getElementById('output-exit')
    };
    const businessUrlInput = document.getElementById('businessUrl');
    const copyButtons = Array.from(document.querySelectorAll('.copy-btn'));
    const submitButton = form?.querySelector('button[type="submit"]');

    if (!form || Object.values(outputs).some(el => !el)) {
        console.error('AgentFlow form or output containers not found.');
        return;
    }

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
            mainGoal: formData.get('mainGoal')?.toString().trim() || '',
            businessUrl: formData.get('businessUrl')?.toString().trim() || ''
        };

        const businessName = deriveBusinessName(payload.businessUrl);
        let siteSummary = '';
        if (payload.businessUrl) {
            try {
                siteSummary = await summarizeSite(payload.businessUrl);
                console.info('Site summary:', siteSummary);
            } catch (err) {
                console.warn('Site summary failed:', err);
            }
        }

        const baseContext = [
            `Business URL: ${payload.businessUrl || 'None provided.'}`,
            `Business name/context: ${businessName || 'Not available.'}`,
            `Background (site summary): ${siteSummary || 'Not available.'}`,
            `Goal/use cases: ${payload.mainGoal || 'N/A'}`
        ].join('\n');

        setLoading(true);
        try {
            const [main, tone, intro, guardrails, lead, exit] = await Promise.all([
                callSection(promptTemplates.mainInstruction, baseContext),
                callSection(promptTemplates.tone, baseContext),
                callSection(promptTemplates.intro, baseContext),
                callSection(promptTemplates.guardrails, baseContext),
                maybeCallLead(promptTemplates.leadCriteria, baseContext, payload.mainGoal),
                callSection(promptTemplates.exitConditions, baseContext)
            ]);
            renderOutputs({ main, tone, intro, guardrails, lead, exit });
        } catch (error) {
            renderError(error.message);
        } finally {
            setLoading(false);
        }
    });

    async function callProxy(body) {
        const response = await fetch(PROXY_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (DEBUG_LOG) {
            console.debug('AgentFlow request:', body);
        }

        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            throw new Error(`OpenAI API error (${response.status}): ${errorText || response.statusText}`);
        }

        const data = await response.json();
        if (DEBUG_LOG) {
            console.debug('AgentFlow response:', data);
        }
        const content = data.content || data.choices?.[0]?.message?.content || '';
        if (typeof content === 'string') return content;
        return JSON.stringify(content);
    }

    async function callSection(sectionPrompt, baseContext) {
        const body = {
            model: MODEL,
            temperature: 0.2,
            messages: [
                { role: 'system', content: [baseContext, 'Respond concisely for this section only.'].join('\n') },
                { role: 'user', content: sectionPrompt }
            ]
        };
        const content = await callProxy(body);
        const parsed = parseJsonSafe(content);
        if (parsed) return parsed;
        return content;
    }

    async function maybeCallLead(sectionPrompt, baseContext, goal) {
        if (!isSalesGoal(goal)) {
            return 'Not applicable (goal/use cases are not sales-related).';
        }
        return callSection(sectionPrompt, baseContext);
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

    function renderOutputs(parts) {
        const main = formatValue(parts.main) || 'No content returned.';
        const tone = formatValue(parts.tone) || 'No tone guidance returned.';
        const intro = formatValue(parts.intro) || 'No intro message returned.';
        const guardrails = formatValue(parts.guardrails) || 'No guardrails returned.';
        const lead = formatValue(parts.lead) || 'Not applicable.';
        const exit = formatValue(parts.exit) || 'No exit conditions returned.';

        outputs.main.classList.remove('muted');
        outputs.tone.classList.remove('muted');
        outputs.intro.classList.remove('muted');
        outputs.guardrails.classList.remove('muted');
        outputs.lead.classList.remove('muted');
        outputs.exit.classList.remove('muted');

        outputs.main.textContent = main;
        outputs.tone.textContent = tone;
        outputs.intro.textContent = intro;
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

    async function summarizeSite(url) {
        const response = await fetch('/api/summarize', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ url })
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`Summarize failed: ${response.status} ${text}`);
        }

        const data = await response.json();
        return data.summary?.trim() || '';
    }

    function deriveBusinessName(url) {
        if (!url) return '';
        try {
            const parsed = new URL(url);
            const host = parsed.hostname.replace(/^www\./i, '');
            const parts = host.split('.');
            if (parts.length > 1) {
                return parts[0];
            }
            return host;
        } catch {
            return '';
        }
    }

    function isSalesGoal(text) {
        if (!text) return false;
        const hay = text.toLowerCase();
        return ['sale', 'sales', 'lead', 'pipeline', 'deal', 'book a demo', 'demo', 'quote', 'pricing', 'prospect', 'opportunity'].some(k => hay.includes(k));
    }
})();
