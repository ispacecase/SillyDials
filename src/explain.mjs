// Plain-language explanations for options. Pure data + lookup.

/** Provider request fields, by option key. */
export const FIELD_EXPLANATIONS = Object.freeze({
    temperature: 'How adventurous the word choices are. Low is safe and predictable; high is creative but can ramble.',
    top_p: 'Only picks from the most likely words that together add up to this share. Lower is tighter and safer.',
    top_k: 'Only picks from this many of the most likely next words. Leave unset unless you know you want it.',
    min_p: 'Drops words that are much less likely than the best choice. Helps a high temperature stay sensible. 0.05 is a common choice.',
    max_temp: 'Upper end of "dynamic temperature": the temperature can rise this high when the model is unsure. Set together with Min temp.',
    min_temp: 'Lower end of "dynamic temperature": the temperature can drop this low when the model is confident. Set together with Max temp.',
    repetition_penalty: 'Discourages repeating words. 1.0 means off. Careful: even small values can garble text (words joined by dashes, odd spellings).',
    frequency_penalty: 'Discourages words the more often they already appeared. Careful: can garble text.',
    presence_penalty: 'Discourages any word that already appeared, pushing toward new topics. Careful: can garble text.',
    max_tokens: 'The most the model may write in one reply, thinking included. SillyTavern\'s Max Response Length usually covers this.',
    max_completion_tokens: 'Newer name for the reply limit, thinking included. SillyTavern\'s Max Response Length usually covers this.',
    seed: 'A fixed number that makes the same request give the same reply. Leave unset for variety.',
    stop: 'Text that makes the model stop writing when it appears, e.g. ["\\nUser:"]. Up to 4.',
    stop_token_ids: 'Like stop text, but as token numbers. Rarely needed.',
    n: 'How many different replies to write at once (SillyTavern shows them as swipes). Each one costs tokens.',
    verbosity: 'Asks for shorter or longer replies, on models that support it.',
    'text.verbosity': 'Same as Verbosity, in the newer OpenAI format. Set one or the other.',
    reasoning_effort: 'How hard the model thinks before answering. Higher is more careful but slower and uses more tokens.',
    'reasoning.effort': 'Same as Reasoning effort, in the newer format. If both are set, Reasoning effort wins.',
    'reasoning.enabled': 'Turn thinking off completely on models that allow it. Off makes replies faster and cheaper.',
    'reasoning.summary': 'Whether you get a short summary of the model\'s thinking.',
    prompt_cache_key: 'A label that helps the provider reuse the start of your prompt. Leave unset; Dials doesn\'t need it.',
    prompt_cache_retention: 'How long the provider keeps the unchanged start of your chat cached. "Extended" makes long chats cheaper and faster.',
    logprobs: 'Debugging: return how likely each word was. Not useful for writing.',
    top_logprobs: 'Debugging: how many alternatives to list for each word. Not useful for writing.',
    user: 'A tracking label. Ignored by Venice.',
    anon_user_id: 'An anonymous label for who the end user is, for providers that track abuse per user. Leave unset.',
    fallbacks: 'For Claude models only: a backup model if Claude refuses. Rarely needed.',
    store: 'OpenAI-only: keep the request on their servers. Ignored by Venice.',
    include: 'Ask for extra data in the reply. Technical; leave unset.',
    metadata: 'Tracking labels attached to the request. Technical; leave unset.',
    parallel_tool_calls: 'For tool use: let the model call several tools at once.',
    response_format: 'Force a structured format such as JSON. Not for normal chat.',
    tool_choice: 'For tool use: which tool the model must use.',
    tools: 'Functions the model may call. SillyTavern manages this itself.',
    'venice_parameters.character_slug': 'Use one of Venice\'s public characters (its "Public ID"). Leave unset to use your own character.',
    'venice_parameters.strip_thinking_response': 'Keep the model thinking, but remove the thinking from the reply you see.',
    'venice_parameters.disable_thinking': 'Turn thinking off and remove it from the reply. Faster and cheaper; may lower quality on hard tasks.',
    'venice_parameters.enable_e2ee': 'End-to-end encryption, on models that support it. Venice turns it on by default where it can.',
    'venice_parameters.enable_web_search': 'Let the model search the web. "Auto" lets it decide; "On" always searches (costs extra).',
    'venice_parameters.enable_web_scraping': 'Read the web pages you link in your message.',
    'venice_parameters.enable_web_citations': 'When web search is used, mark sources with little numbers.',
    'venice_parameters.include_search_results_in_stream': 'Experimental: send the raw search results at the start of the reply.',
    'venice_parameters.return_search_results_as_documents': 'Also hand search results over as a tool call. Technical.',
    'venice_parameters.include_venice_system_prompt': 'Venice adds its own instructions on top of yours. Turn off so only your character and prompts steer the model.',
    'venice_parameters.enable_x_search': 'Let the model search the web and X (Twitter), on supported models.',
});

/** SillyTavern's own panel settings, by the title's data-i18n key. */
export const SILLYTAVERN_EXPLANATIONS = Object.freeze({
    'Temperature': FIELD_EXPLANATIONS.temperature,
    'Top P': FIELD_EXPLANATIONS.top_p,
    'Top K': FIELD_EXPLANATIONS.top_k,
    'Min P': FIELD_EXPLANATIONS.min_p,
    'Top A': 'Drops words much less likely than the best one, scaled by how confident the model is. Rarely needed.',
    'Frequency Penalty': FIELD_EXPLANATIONS.frequency_penalty,
    'Presence Penalty': FIELD_EXPLANATIONS.presence_penalty,
    'Repetition Penalty': FIELD_EXPLANATIONS.repetition_penalty,
    'Context Size (tokens)': 'How much of the chat (plus character, lore and prompts) is sent each time. Bigger remembers more but costs more per reply.',
    'Max Response Length (tokens)': 'The most the model may write per reply, thinking included. If replies stop mid-sentence, raise this.',
    'Multiple swipes per generation': 'Write several replies at once and show them as swipes. Each costs tokens.',
    'Seed': FIELD_EXPLANATIONS.seed,
    'Reasoning Effort': 'How hard the model thinks before answering. On Custom endpoints SillyTavern often doesn\'t send this; Dials\' Provider options tab does.',
    'Verbosity': FIELD_EXPLANATIONS.verbosity,
});

/** Plain explanation for a provider option, or null. */
export function explainField(key) {
    return FIELD_EXPLANATIONS[key] ?? null;
}

/** Plain explanation for one of SillyTavern's own settings, by its title key, or null. */
export function explainSillyTavern(titleKey) {
    return SILLYTAVERN_EXPLANATIONS[titleKey] ?? null;
}
