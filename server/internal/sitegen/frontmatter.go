package sitegen

import (
	"bytes"
	"fmt"
	"strings"
	"time"
)

// frontMatter is the `key: value` block between two `---` lines at the top of a page.
// Only flat string values are supported; that's all the wiki uses.
type frontMatter map[string]string

// splitFrontMatter returns the front matter, the body after it, and the number of
// lines the front matter took (so problems can report body line numbers).
func splitFrontMatter(src []byte) (frontMatter, []byte, int, error) {
	fm := frontMatter{}
	if !bytes.HasPrefix(src, []byte("---\n")) && !bytes.HasPrefix(src, []byte("---\r\n")) {
		return fm, src, 0, nil
	}
	lines := strings.SplitAfter(string(src), "\n")
	for i := 1; i < len(lines); i++ {
		line := strings.TrimRight(lines[i], "\r\n")
		if line == "---" {
			body := strings.Join(lines[i+1:], "")
			return fm, []byte(body), i + 1, nil
		}
		if strings.TrimSpace(line) == "" || strings.HasPrefix(strings.TrimSpace(line), "#") {
			continue
		}
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			return nil, nil, 0, fmt.Errorf("front matter line %d is not `key: value`: %q", i+1, line)
		}
		value = strings.TrimSpace(value)
		if len(value) >= 2 && (value[0] == '"' || value[0] == '\'') && value[len(value)-1] == value[0] {
			value = value[1 : len(value)-1]
		}
		fm[strings.TrimSpace(key)] = value
	}
	return nil, nil, 0, fmt.Errorf("front matter has no closing `---` line")
}

// Wiki page statuses (ADR 0008). Only published pages go on the public wiki.
const (
	statusDraft     = "draft"
	statusPublished = "published"
)

// checkWikiFrontMatter enforces the fields every wiki page needs. A typo such as
// `status: publish` must fail the build rather than silently hiding the page.
func checkWikiFrontMatter(fm frontMatter) []string {
	var errs []string
	if fm["title"] == "" {
		errs = append(errs, "front matter needs `title: <page title>`")
	}
	switch fm["status"] {
	case statusDraft, statusPublished:
	case "":
		errs = append(errs, "front matter needs `status: draft` or `status: published`")
	default:
		errs = append(errs, fmt.Sprintf("front matter has `status: %s`; it must be `draft` or `published`", fm["status"]))
	}
	if u := fm["updated"]; u == "" {
		errs = append(errs, "front matter needs `updated: YYYY-MM-DD`")
	} else if _, err := time.Parse("2006-01-02", u); err != nil {
		errs = append(errs, fmt.Sprintf("front matter has `updated: %s`; use YYYY-MM-DD", u))
	}
	return errs
}
