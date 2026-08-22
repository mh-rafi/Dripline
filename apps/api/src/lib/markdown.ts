import { marked } from "marked";

marked.setOptions({ breaks: true, gfm: true });

/** Converts markdown source to HTML, matching listmonk's model: conversion
 * happens once per campaign (not per recipient), before merge-field
 * substitution -- so `{{ Subscriber.Name }}` written inside markdown text
 * survives the conversion untouched and is rendered afterwards as usual. */
export function markdownToHtml(source: string): string {
  // { async: false } guarantees a synchronous string return at runtime;
  // marked's overloads don't narrow on the literal, hence the cast.
  return marked.parse(source, { async: false }) as string;
}
