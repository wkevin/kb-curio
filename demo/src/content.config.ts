import { kbCurioArticleCollection } from '@kb-curio/core/article-collection';

export const collections = {
  article: await kbCurioArticleCollection(),
};
