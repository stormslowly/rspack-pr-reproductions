include!("../src/lib.rs");

fn remaining_watch(alias_first: bool, target: &InternedPath, alias: &InternedPath) -> (u32, bool) {
  use paths::{
    PathTracker,
    links::{BoundDep, DepKind, LinkMappings, LinkResolver},
  };

  let mut mappings = LinkMappings::default();
  let files = PathTracker::default();
  let directories = PathTracker::default();
  let missing = PathTracker::default();
  let trackers = [&files, &directories, &missing];
  let mut resolver = LinkResolver::new(true);
  let mut evicted = Vec::new();
  let order = if alias_first { [alias, target] } else { [target, alias] };
  for logical in order {
    let resolved = resolver.resolve(logical);
    assert_eq!(&resolved.target, target);
    assert!(resolved.first_missing.is_none());
    let binding = BoundDep {
      target: resolved.target,
      target_active: true,
      links: resolved.links,
      first_missing: resolved.first_missing,
    };
    mappings.bind_dep(DepKind::File, logical.clone(), binding, true, trackers, &mut evicted);
  }
  let target_refs = mappings.watch_refs[DepKind::File as usize][target];
  assert!(mappings.unbind_dep(DepKind::File, alias, trackers, &mut evicted));
  (target_refs, mappings.is_physically_watched_file_or_missing(target))
}

fn main() {
  let fixture = tempfile::tempdir().expect("create fixture");
  let root = std::fs::canonicalize(fixture.path()).expect("resolve fixture");
  let target = InternedPath::from(root.join("entry.js"));
  let alias = InternedPath::from(root.join("alias.js"));
  std::fs::write(&target, "module.exports = 1").expect("write target");
  std::os::unix::fs::symlink(target.as_path(), alias.as_path()).expect("create file symlink");
  for alias_first in [false, true] {
    let (target_refs, remaining) = remaining_watch(alias_first, &target, &alias);
    println!("alias_first={alias_first} refs_before={target_refs} target_watched_after={remaining}");
  }
}
