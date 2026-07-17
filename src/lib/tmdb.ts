/**
 * TMDB API client
 * Docs: https://developer.themoviedb.org/docs
 *
 * Used for movie/tv lookup so we can build a translation context
 * (title, plot, cast, characters, genres, keywords, etc.) before
 * translating subtitles with DeepSeek.
 */

const TMDB_BASE = "https://api.themoviedb.org/3";

export const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

export type TmdbMediaType = "movie" | "tv";

export interface TmdbSearchResult {
  id: number;
  media_type: TmdbMediaType;
  title: string;
  original_title?: string;
  release_date?: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
}

export interface TmdbMovieDetails {
  id: number;
  title: string;
  original_title: string;
  release_date: string;
  runtime: number | null;
  genres: { id: number; name: string }[];
  overview: string;
  tagline: string;
  poster_path: string | null;
  backdrop_path: string | null;
  production_companies: { id: number; name: string }[];
  production_countries: { iso_3166_1: string; name: string }[];
  spoken_languages: { english_name: string; iso_639_1: string; name: string }[];
  credits?: {
    cast: {
      id: number;
      name: string;
      character: string;
      order: number;
      profile_path: string | null;
    }[];
    crew: {
      id: number;
      name: string;
      job: string;
      department: string;
    }[];
  };
  keywords?: {
    keywords: { id: number; name: string }[];
  };
  images?: {
    backdrops: { file_path: string; iso_639_1: string | null }[];
    posters: { file_path: string; iso_639_1: string | null }[];
  };
}

export interface TmdbTvDetails {
  id: number;
  name: string;
  original_name: string;
  first_air_date: string;
  number_of_seasons: number;
  number_of_episodes: number;
  episode_run_time: number[];
  genres: { id: number; name: string }[];
  overview: string;
  tagline: string;
  poster_path: string | null;
  backdrop_path: string | null;
  production_companies: { id: number; name: string }[];
  production_countries: { iso_3166_1: string; name: string }[];
  spoken_languages: { english_name: string; iso_639_1: string; name: string }[];
  credits?: {
    cast: {
      id: number;
      name: string;
      character: string;
      order: number;
      profile_path: string | null;
    }[];
    crew: {
      id: number;
      name: string;
      job: string;
      department: string;
    }[];
  };
  keywords?: {
    results: { id: number; name: string }[];
  };
  images?: {
    backdrops: { file_path: string; iso_639_1: string | null }[];
    posters: { file_path: string; iso_639_1: string | null }[];
  };
}

function authHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };
}

async function tmdbFetch<T>(
  path: string,
  apiKey: string,
  params: Record<string, string | number | boolean> = {}
): Promise<T> {
  if (!apiKey) {
    throw new Error(
      "TMDB API key is missing. Set TMDB_API_KEY in the server env or pass it via the UI settings."
    );
  }
  const url = new URL(`${TMDB_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, { headers: authHeaders(apiKey) });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`TMDB ${res.status}: ${body}`);
  }
  return (await res.json()) as T;
}

export async function searchMulti(
  query: string,
  apiKey: string,
  page = 1
): Promise<{
  page: number;
  total_pages: number;
  total_results: number;
  results: TmdbSearchResult[];
}> {
  const data = await tmdbFetch<{
    page: number;
    total_pages: number;
    total_results: number;
    results: any[];
  }>("/search/multi", apiKey, {
    query,
    page,
    include_adult: false,
    language: "en-US",
  });

  const results: TmdbSearchResult[] = data.results
    .filter((r) => r.media_type === "movie" || r.media_type === "tv")
    .map((r) => ({
      id: r.id,
      media_type: r.media_type,
      title: r.title || r.name || "Untitled",
      original_title: r.original_title || r.original_name,
      release_date: r.release_date || r.first_air_date,
      overview: r.overview || "",
      poster_path: r.poster_path ?? null,
      backdrop_path: r.backdrop_path ?? null,
      vote_average: r.vote_average ?? 0,
    }));

  return { ...data, results };
}

export async function getMovieDetails(
  id: number,
  apiKey: string
): Promise<TmdbMovieDetails> {
  return tmdbFetch<TmdbMovieDetails>(`/movie/${id}`, apiKey, {
    append_to_response: "credits,keywords,images",
    include_image_language: "en,null",
    language: "en-US",
  });
}

export async function getTvDetails(
  id: number,
  apiKey: string
): Promise<TmdbTvDetails> {
  return tmdbFetch<TmdbTvDetails>(`/tv/${id}`, apiKey, {
    append_to_response: "credits,keywords,images",
    include_image_language: "en,null",
    language: "en-US",
  });
}

export function posterUrl(
  path: string | null,
  size: "w92" | "w154" | "w185" | "w342" | "w500" | "original" = "w342"
): string {
  if (!path) return "";
  return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

export function backdropUrl(
  path: string | null,
  size: "w300" | "w780" | "w1280" | "original" = "w1280"
): string {
  if (!path) return "";
  return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

/**
 * Compact, LLM-friendly summary of a title. This is the canonical
 * "movie context" we feed to DeepSeek before translation so the
 * model knows the universe, characters, tone, and key terms.
 */
export interface TranslationContextBundle {
  media_type: TmdbMediaType;
  title: string;
  original_title?: string;
  release_year: string;
  runtime_minutes: number | null;
  genres: string[];
  tagline: string;
  overview: string;
  cast: { actor: string; character: string }[];
  directors: string[];
  writers: string[];
  keywords: string[];
  production_countries: string[];
  spoken_languages: string[];
  poster_url: string;
  backdrop_url: string;
}

export function buildContextBundle(
  details: TmdbMovieDetails | TmdbTvDetails,
  mediaType: TmdbMediaType
): TranslationContextBundle {
  const credits = details.credits;
  const cast = (credits?.cast ?? [])
    .slice(0, 25)
    .map((c) => ({ actor: c.name, character: c.character }));

  const directors = (credits?.crew ?? [])
    .filter((c) => c.job === "Director")
    .map((c) => c.name);

  const writers = (credits?.crew ?? [])
    .filter((c) => c.job === "Writer" || c.job === "Screenplay" || c.job === "Story")
    .map((c) => c.name);

  const keywords =
    mediaType === "movie"
      ? ((details as TmdbMovieDetails).keywords?.keywords ?? []).map((k) => k.name)
      : ((details as TmdbTvDetails).keywords?.results ?? []).map((k) => k.name);

  const title =
    mediaType === "movie"
      ? (details as TmdbMovieDetails).title
      : (details as TmdbTvDetails).name;

  const originalTitle =
    mediaType === "movie"
      ? (details as TmdbMovieDetails).original_title
      : (details as TmdbTvDetails).original_name;

  const releaseDate =
    mediaType === "movie"
      ? (details as TmdbMovieDetails).release_date
      : (details as TmdbTvDetails).first_air_date;

  const runtime =
    mediaType === "movie"
      ? (details as TmdbMovieDetails).runtime
      : (details as TmdbTvDetails).episode_run_time?.[0] ?? null;

  return {
    media_type: mediaType,
    title,
    original_title: originalTitle,
    release_year: releaseDate ? releaseDate.slice(0, 4) : "",
    runtime_minutes: runtime ?? null,
    genres: details.genres.map((g) => g.name),
    tagline: details.tagline,
    overview: details.overview,
    cast,
    directors,
    writers,
    keywords,
    production_countries: details.production_countries.map((c) => c.name),
    spoken_languages: details.spoken_languages.map((l) => l.english_name),
    poster_url: posterUrl(details.poster_path, "w342"),
    backdrop_url: backdropUrl(details.backdrop_path, "w1280"),
  };
}
