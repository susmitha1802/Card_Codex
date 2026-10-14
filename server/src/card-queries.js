// Every lookup checks eligibility in MongoDB, using its clock rather than the
// application clock. Missing or mistyped protection/expiry fields fail closed.
export function activeCardFilter(shareToken) {
  return {
    share_token: shareToken,
    schema_version: 1,
    media: { $type: 'array' },
    unlock_code_hash: { $type: ['string', 'null'] },
    $expr: { $and: [
      // Query $type also matches array elements. Expression $type checks the
      // field itself, so a corrupt [null, hash] cannot become a public card.
      { $eq: [{ $type: '$share_token' }, 'string'] },
      { $in: [{ $type: '$unlock_code_hash' }, ['string', 'null']] },
      { $cond: [
        { $and: [
          { $eq: [{ $type: '$legacy_mysql_id' }, 'string'] },
          { $eq: [{ $type: '$legacy_mysql_status_active' }, 'bool'] },
          { $eq: ['$status', '$legacy_mysql_status_value'] },
        ] },
        { $eq: ['$legacy_mysql_status_active', true] },
        { $eq: ['$status', 'active'] },
      ] },
      { $or: [
        { $eq: [{ $type: '$expires_at' }, 'null'] },
        { $and: [
          { $eq: [{ $type: '$expires_at' }, 'date'] },
          { $gt: ['$expires_at', '$$NOW'] },
        ] },
      ] },
    ] },
  };
}

export const tokenCollation = { locale: 'simple' };
export const publicCardProjection = {
  _id: 0, occasion: 1, title: 1, message: 1, recipient_name: 1, theme: 1, customization: 1,
};
export const protectionProjection = { _id: 0, unlock_code_hash: 1, unlock_hints: 1 };
