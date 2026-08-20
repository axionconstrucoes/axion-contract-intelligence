export interface GmailHeader {
  name?: string | null;
  value?: string | null;
}

export type GmailDirection = "INBOUND" | "OUTBOUND";

export interface GmailPolicyResult {
  eligible: boolean;
  direction: GmailDirection | null;
  addresses: string[];
  rejectedDomains: string[];
  reason: string | null;
}

export function extractEmailAddresses(value?: string | null): string[] {
  if (!value) {
    return [];
  }

  return Array.from(
    new Set(
      (value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [])
        .map((address) => address.toLowerCase())
    )
  );
}

function getHeader(
  headers: GmailHeader[],
  name: string
): string | null {
  return (
    headers.find(
      (header) => header.name?.toLowerCase() === name.toLowerCase()
    )?.value ?? null
  );
}

function domainOf(address: string): string | null {
  const parts = address.toLowerCase().split("@");

  if (parts.length !== 2 || !parts[1]) {
    return null;
  }

  return parts[1];
}

export function evaluateGmailMessagePolicy(
  headers: GmailHeader[],
  mailbox: string,
  allowedDomains: string[]
): GmailPolicyResult {
  const normalizedMailbox = mailbox.toLowerCase();

  const from = extractEmailAddresses(getHeader(headers, "From"));
  const to = extractEmailAddresses(getHeader(headers, "To"));
  const cc = extractEmailAddresses(getHeader(headers, "Cc"));
  const bcc = extractEmailAddresses(getHeader(headers, "Bcc"));

  const recipients = Array.from(new Set([...to, ...cc, ...bcc]));
  const addresses = Array.from(new Set([...from, ...recipients]));

  if (addresses.length === 0) {
    return {
      eligible: false,
      direction: null,
      addresses: [],
      rejectedDomains: [],
      reason: "NO_PARTICIPANT_ADDRESSES",
    };
  }

  const mailboxIsSender = from.includes(normalizedMailbox);
  const mailboxIsRecipient = recipients.includes(normalizedMailbox);

  if (!mailboxIsSender && !mailboxIsRecipient) {
    return {
      eligible: false,
      direction: null,
      addresses,
      rejectedDomains: [],
      reason: "MAILBOX_NOT_PARTICIPANT",
    };
  }

  const normalizedAllowedDomains = new Set(
    allowedDomains.map((domain) => domain.toLowerCase())
  );

  const rejectedDomains = Array.from(
    new Set(
      addresses
        .map(domainOf)
        .filter((domain): domain is string => Boolean(domain))
        .filter((domain) => !normalizedAllowedDomains.has(domain))
    )
  );

  if (rejectedDomains.length > 0) {
    return {
      eligible: false,
      direction: mailboxIsSender ? "OUTBOUND" : "INBOUND",
      addresses,
      rejectedDomains,
      reason: "DOMAIN_NOT_AUTHORIZED",
    };
  }

  return {
    eligible: true,
    direction: mailboxIsSender ? "OUTBOUND" : "INBOUND",
    addresses,
    rejectedDomains: [],
    reason: null,
  };
}
