// JSDoc typedefs for the data contract shared by the mock service and the future backend REST APIs.
// Screens never import mock data directly; they receive these shapes from src/services/api.js.

/**
 * @typedef {"draft"|"live"|"paused"|"completed"|"archived"} CampaignStatus
 * @typedef {"email"|"linkedin"|"sms"|"voice"} ChannelKey
 * @typedef {"discovered"|"researched"|"qualified"|"contacted"|"engaged"|"meeting"|"opportunity"} StageKey
 */

/**
 * @typedef {Object} Funnel
 * @property {number} discovered
 * @property {number} researched
 * @property {number} qualified
 * @property {number} contacted
 * @property {number} engaged
 * @property {number} meeting
 * @property {number} opportunity
 */

/**
 * @typedef {Object} Campaign
 * @property {string} id
 * @property {string} name
 * @property {string} shortName
 * @property {CampaignStatus} status
 * @property {string} owner
 * @property {string} objective
 * @property {string} description
 * @property {string} icpSummary
 * @property {string} icpText
 * @property {string[]} geography
 * @property {string[]} personas
 * @property {string} companyCriteria
 * @property {string} exclusionCriteria
 * @property {ChannelKey[]} channels
 * @property {string} qualificationPrompt
 * @property {number} dailyLimit
 * @property {string} workingHours
 * @property {{firstOutreach:boolean, meetingTime:boolean, escalate:boolean}} approvals
 * @property {{id:string, name:string, category:string}[]} sources
 * @property {Funnel} funnel
 * @property {{emails:number, linkedin:number, replies:number, followups:number, costPerQualified:number}} outreach
 * @property {number} responseRate
 * @property {number} createdTs
 * @property {number} modifiedTs
 */

/**
 * @typedef {Object} Prospect
 * @property {string} id
 * @property {string} campaignId
 * @property {string} name
 * @property {string} title
 * @property {string} company
 * @property {string} email
 * @property {string} city
 * @property {string} linkedin
 * @property {string} industry
 * @property {string} size
 * @property {string} funding
 * @property {string[]} tech
 * @property {string} stage
 * @property {number|null} fit
 * @property {string} channel
 * @property {string} lastAction   May contain "{ago}", replaced by a relative time in the UI.
 * @property {number} lastTs
 * @property {string} nextStep
 * @property {string[]} reasons
 * @property {string[]} evidence
 * @property {{status:string, reasoning:string, agent:string, harness:string, ts:number}} qual
 * @property {{kind:string, text:string, when:string}[]} history
 * @property {{dir:"out"|"in", text:string, when:string}[]} conversation
 */

/**
 * @typedef {Object} AgentEvent
 * @property {string} id
 * @property {string|null} campaignId
 * @property {string} type
 * @property {string} text          Uses **bold** markers for emphasis.
 * @property {number} ts
 * @property {boolean} featured     Shown in the Command Center live feed.
 */

/**
 * @typedef {Object} AgentDecision
 * @property {string} id
 * @property {"qualified"|"blocked"|"meeting"|"rejected"|"enriched"|"strategy"} kind
 * @property {string} campaignId
 * @property {string|null} prospectId
 * @property {string} agent
 * @property {string} harness
 * @property {number} ts
 * @property {string} headline
 * @property {string} summary
 * @property {string[]} evidence
 * @property {number|null} score
 * @property {string[]} retrieved
 * @property {string} instruction
 * @property {{ok:boolean, text:string}} conflict
 * @property {string} finalAction
 */

/**
 * @typedef {Object} ApprovalItem
 * @property {string} id
 * @property {"pending"|"approved"|"rejected"} status
 * @property {"first"|"followup"|"pricing"|"meeting"|"escalation"} type
 * @property {string} prospectId
 * @property {string} campaignId
 * @property {string} name
 * @property {string} company
 * @property {string} tag
 * @property {string} tagTone
 * @property {string} summary
 * @property {number} requestedTs
 * @property {{title:string, body:string}} recommendation
 * @property {{subject:string, body:string}} draft
 * @property {string} nextActionText
 * @property {string} source
 */

/**
 * @typedef {Object} PromptVersion
 * @property {string} version
 * @property {string} changedBy
 * @property {string} date
 * @property {"active"|"archived"} status
 * @property {string} text
 * @property {string|null} activatedBy
 * @property {number|null} activatedTs
 */

/**
 * @typedef {Object} Agent
 * @property {string} id
 * @property {string} listName
 * @property {string} title
 * @property {string} settingsName
 * @property {string} description
 * @property {boolean} enabled
 * @property {string|null} disabledBy
 * @property {number|null} disabledTs
 * @property {PromptVersion[]} versions
 * @property {{campaignId:string, text:string, ts:number}[]} overrides
 */

/**
 * @typedef {Object} ChannelStatus
 * @property {ChannelKey} key
 * @property {string} label
 * @property {string} note
 * @property {boolean} enabled
 * @property {number|null} pausedTs
 */

export {};
