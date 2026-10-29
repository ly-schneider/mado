export type Provider = "github" | "gitlab";

export interface GitCommit {
  sha: string;
  message: string;
  url: string;
  at: Date | null;
}

/** Provider payloads reduced to the three things mado links: pushes, pull/merge requests and new branches. */
export type GitEvent =
  | { kind: "push"; repo: string; branch: string; branchUrl: string; commits: GitCommit[] }
  | {
      kind: "pr";
      repo: string;
      number: string;
      title: string;
      url: string;
      state: "open" | "merged" | "closed";
      action: "opened" | "edited" | "closed" | "merged";
      branch: string | null;
      branchUrl: string | null;
    }
  | { kind: "branch"; repo: string; branch: string; branchUrl: string }
  | { kind: "ignored"; repo: string | null; reason: string };

type Json = any;

const NULL_SHA = /^0+$/;

function branchFromRef(ref: unknown): string | null {
  return typeof ref === "string" && ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : null;
}

function commits(list: Json): GitCommit[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((c) => typeof c?.id === "string" && typeof c?.message === "string")
    .map((c) => ({ sha: c.id, message: c.message, url: String(c.url ?? ""), at: c.timestamp ? new Date(c.timestamp) : null }));
}

export function parseGithub(event: string, body: Json): GitEvent[] {
  const repo: string | null = body?.repository?.full_name ?? null;
  if (!repo) return [{ kind: "ignored", repo: null, reason: "no repository" }];
  const treeUrl = (branch: string) => `${body.repository.html_url ?? `https://github.com/${repo}`}/tree/${branch}`;

  switch (event) {
    case "push": {
      const branch = branchFromRef(body.ref);
      if (!branch || body.deleted) return [{ kind: "ignored", repo, reason: "not a branch push" }];
      return [{ kind: "push", repo, branch, branchUrl: treeUrl(branch), commits: commits(body.commits) }];
    }
    case "create": {
      if (body.ref_type !== "branch" || typeof body.ref !== "string") return [{ kind: "ignored", repo, reason: "not a branch" }];
      return [{ kind: "branch", repo, branch: body.ref, branchUrl: treeUrl(body.ref) }];
    }
    case "pull_request": {
      const pr = body.pull_request;
      if (!pr) return [{ kind: "ignored", repo, reason: "no pull_request" }];
      const merged = Boolean(pr.merged);
      const action: Json = body.action;
      const mapped =
        action === "opened" || action === "reopened"
          ? "opened"
          : action === "edited"
            ? "edited"
            : action === "closed"
              ? merged
                ? "merged"
                : "closed"
              : null;
      if (!mapped) return [{ kind: "ignored", repo, reason: `pull_request.${action}` }];
      const branch: string | null = pr.head?.ref ?? null;
      return [
        {
          kind: "pr",
          repo,
          number: String(pr.number),
          title: String(pr.title ?? ""),
          url: String(pr.html_url ?? ""),
          state: merged ? "merged" : pr.state === "closed" ? "closed" : "open",
          action: mapped,
          branch,
          branchUrl: branch ? treeUrl(branch) : null,
        },
      ];
    }
    default:
      return [{ kind: "ignored", repo, reason: event }];
  }
}

export function parseGitlab(event: string, body: Json): GitEvent[] {
  const repo: string | null = body?.project?.path_with_namespace ?? null;
  if (!repo) return [{ kind: "ignored", repo: null, reason: "no project" }];
  const treeUrl = (branch: string) => `${body.project.web_url}/-/tree/${branch}`;

  switch (event) {
    case "Push Hook": {
      const branch = branchFromRef(body.ref);
      if (!branch || NULL_SHA.test(body.after ?? "")) return [{ kind: "ignored", repo, reason: "not a branch push" }];
      const events: GitEvent[] = [];
      // GitLab has no separate create event: a push whose "before" is the null sha creates the branch.
      if (NULL_SHA.test(body.before ?? "")) events.push({ kind: "branch", repo, branch, branchUrl: treeUrl(branch) });
      events.push({ kind: "push", repo, branch, branchUrl: treeUrl(branch), commits: commits(body.commits) });
      return events;
    }
    case "Merge Request Hook": {
      const mr = body.object_attributes;
      if (!mr) return [{ kind: "ignored", repo, reason: "no object_attributes" }];
      const action: Json = mr.action;
      const mapped =
        action === "open" || action === "reopen"
          ? "opened"
          : action === "update"
            ? "edited"
            : action === "merge"
              ? "merged"
              : action === "close"
                ? "closed"
                : null;
      if (!mapped) return [{ kind: "ignored", repo, reason: `merge_request.${action}` }];
      const branch: string | null = mr.source_branch ?? null;
      return [
        {
          kind: "pr",
          repo,
          number: String(mr.iid),
          title: String(mr.title ?? ""),
          url: String(mr.url ?? ""),
          state: mr.state === "merged" ? "merged" : mr.state === "opened" ? "open" : "closed",
          action: mapped,
          branch,
          branchUrl: branch ? treeUrl(branch) : null,
        },
      ];
    }
    default:
      return [{ kind: "ignored", repo, reason: event }];
  }
}
