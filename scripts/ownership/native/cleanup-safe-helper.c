#define _GNU_SOURCE

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/file.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <unistd.h>

#define ABI_VERSION "sanctuary.cleanup-host.v1"
#define MAX_FIELD_BYTES 4096
#define QUARANTINE_PREFIX ".sanctuary-quarantine-"
#define SANCTUARY_RESOLVE_NO_XDEV 0x01
#define SANCTUARY_RESOLVE_NO_MAGICLINKS 0x02
#define SANCTUARY_RESOLVE_NO_SYMLINKS 0x04
#define SANCTUARY_RESOLVE_BENEATH 0x08
struct sanctuary_open_how {
  uint64_t flags;
  uint64_t mode;
  uint64_t resolve;
};
_Static_assert(sizeof(struct sanctuary_open_how) == 24, "openat2 ABI changed");
static void json_state(const char *state, const char *reason) {
  if (reason == NULL) printf("{\"state\":\"%s\"}\n", state);
  else printf("{\"reason\":\"%s\",\"state\":\"%s\"}\n", reason, state);
}
static bool decimal(const char *value) {
  if (value == NULL || *value == '\0') return false;
  for (const char *cursor = value; *cursor != '\0'; cursor += 1) {
    if (*cursor < '0' || *cursor > '9') return false;
  }
  return true;
}
static bool safe_field(const char *value) {
  return value != NULL && strnlen(value, MAX_FIELD_BYTES + 1) <= MAX_FIELD_BYTES;
}
static bool safe_basename(const char *value) {
  return safe_field(value) && value[0] != '\0' && strcmp(value, ".") != 0
    && strcmp(value, "..") != 0 && strchr(value, '/') == NULL;
}
static int parse_u64(const char *value, uint64_t *result) {
  char *end = NULL;
  if (!decimal(value)) return -1;
  errno = 0;
  unsigned long long parsed = strtoull(value, &end, 10);
  if (errno != 0 || end == NULL || *end != '\0') return -1;
  *result = (uint64_t)parsed;
  return 0;
}
static int pidfd_open_exact(pid_t pid) {
#ifdef SYS_pidfd_open
  return (int)syscall(SYS_pidfd_open, pid, 0);
#else
  (void)pid;
  errno = ENOSYS;
  return -1;
#endif
}
static int pidfd_signal_exact(int descriptor, int signal_number) {
#ifdef SYS_pidfd_send_signal
  return (int)syscall(SYS_pidfd_send_signal, descriptor, signal_number, NULL, 0);
#else
  (void)descriptor;
  (void)signal_number;
  errno = ENOSYS;
  return -1;
#endif
}
static int descriptor_mount_id(int descriptor, uint64_t *mount_id) {
  char path[64];
  int length = snprintf(path, sizeof(path), "/proc/self/fdinfo/%d", descriptor);
  if (length <= 0 || length >= (int)sizeof(path)) return -1;
  int info = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (info < 0) return -1;
  char buffer[4096];
  ssize_t count = read(info, buffer, sizeof(buffer) - 1);
  char extra;
  int extra_count = count >= 0 ? (int)read(info, &extra, 1) : -1;
  int saved = errno;
  close(info);
  errno = saved;
  if (count <= 0 || extra_count != 0) return -1;
  buffer[count] = '\0';
  char *cursor = buffer;
  while (*cursor != '\0') {
    char *line_end = strchr(cursor, '\n');
    if (line_end == NULL) line_end = buffer + count;
    if (strncmp(cursor, "mnt_id:", 7) == 0) {
      char *value = cursor + 7;
      while (value < line_end && (*value == ' ' || *value == '\t')) value += 1;
      char terminal = *line_end;
      *line_end = '\0';
      int result = value < line_end ? parse_u64(value, mount_id) : -1;
      *line_end = terminal;
      return result;
    }
    cursor = *line_end == '\0' ? line_end : line_end + 1;
  }
  return -1;
}
static int openat_exact_fallback(int parent, const char *name, int flags) {
  if (name == NULL || name[0] == '\0' || strchr(name, '/') != NULL || strcmp(name, "..") == 0) {
    errno = EINVAL;
    return -1;
  }
  int descriptor = openat(parent, name, flags | O_NOFOLLOW);
  if (descriptor < 0) return -1;
  struct stat parent_info;
  struct stat child_info;
  uint64_t parent_mount;
  uint64_t child_mount;
  if (fstat(parent, &parent_info) != 0 || fstat(descriptor, &child_info) != 0
      || descriptor_mount_id(parent, &parent_mount) != 0
      || descriptor_mount_id(descriptor, &child_mount) != 0) {
    int saved = errno;
    close(descriptor);
    errno = saved;
    return -1;
  }
  if (parent_info.st_dev == child_info.st_dev && parent_mount == child_mount) return descriptor;
  close(descriptor);
  errno = EXDEV;
  return -1;
}
static int openat2_exact(int parent, const char *name, int flags) {
#ifdef SYS_openat2
  struct sanctuary_open_how how = {
    .flags = (uint64_t)flags,
    .resolve = SANCTUARY_RESOLVE_BENEATH | SANCTUARY_RESOLVE_NO_MAGICLINKS
      | SANCTUARY_RESOLVE_NO_SYMLINKS | SANCTUARY_RESOLVE_NO_XDEV,
  };
#ifdef SANCTUARY_FORCE_OPENAT_FALLBACK
  (void)how;
  errno = ENOSYS;
  int descriptor = -1;
#else
  int descriptor = (int)syscall(SYS_openat2, parent, name, &how, sizeof(how));
#endif
  if (descriptor >= 0 || (errno != ENOSYS && errno != EPERM)) return descriptor;
#endif
  return openat_exact_fallback(parent, name, flags);
}
static int renameat2_exact(int parent, const char *from, const char *to) {
#ifdef SYS_renameat2
  return (int)syscall(SYS_renameat2, parent, from, parent, to, RENAME_NOREPLACE);
#else
  (void)parent;
  (void)from;
  (void)to;
  errno = ENOSYS;
  return -1;
#endif
}
static int read_boot_id(char *buffer, size_t size) {
  int descriptor = open("/proc/sys/kernel/random/boot_id", O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (descriptor < 0) return -1;
  ssize_t count = read(descriptor, buffer, size - 1);
  int saved = errno;
  close(descriptor);
  errno = saved;
  if (count <= 0 || (size_t)count >= size) return -1;
  while (count > 0 && (buffer[count - 1] == '\n' || buffer[count - 1] == '\r')) count -= 1;
  buffer[count] = '\0';
  return count > 0 ? 0 : -1;
}

static int read_start_ticks(pid_t pid, char *result, size_t result_size) {
  char proc_path[64];
  if (snprintf(proc_path, sizeof(proc_path), "/proc/%ld/stat", (long)pid) >= (int)sizeof(proc_path)) return -1;
  int descriptor = open(proc_path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (descriptor < 0) return -1;
  char buffer[4096];
  ssize_t count = read(descriptor, buffer, sizeof(buffer) - 1);
  int saved = errno;
  close(descriptor);
  errno = saved;
  if (count <= 0 || (size_t)count >= sizeof(buffer)) return -1;
  buffer[count] = '\0';
  char *cursor = strrchr(buffer, ')');
  if (cursor == NULL || cursor[1] != ' ') return -1;
  cursor += 2;
  for (int field = 3; field <= 22; field += 1) {
    char *end = strchr(cursor, ' ');
    if (field == 22) {
      if (end != NULL) *end = '\0';
      size_t length = strlen(cursor);
      if (!decimal(cursor) || length + 1 > result_size) return -1;
      memcpy(result, cursor, length + 1);
      return 0;
    }
    if (end == NULL) return -1;
    cursor = end + 1;
  }
  return -1;
}

static int validate_process(int pidfd, pid_t pid, const char *ticks, const char *boot_id) {
  (void)pidfd;
  char observed_boot[128];
  char observed_ticks[64];
  if (read_boot_id(observed_boot, sizeof(observed_boot)) != 0
      || read_start_ticks(pid, observed_ticks, sizeof(observed_ticks)) != 0) return -1;
  return strcmp(observed_boot, boot_id) == 0 && strcmp(observed_ticks, ticks) == 0 ? 1 : 0;
}

struct process_request {
  pid_t pid;
  int signal_number;
  int timeout_ms;
};

static int parse_stop_options(char **argv, struct process_request *request) {
  uint64_t signal_value;
  uint64_t timeout_value;
  if (parse_u64(argv[5], &signal_value) != 0) return -1;
  if (signal_value == 0) return -1;
  if (signal_value >= NSIG) return -1;
  if (parse_u64(argv[6], &timeout_value) != 0) return -1;
  if (timeout_value > 600000) return -1;
  request->signal_number = (int)signal_value;
  request->timeout_ms = (int)timeout_value;
  return 0;
}

static int parse_process_request(bool stop, int argc, char **argv, struct process_request *request) {
  if (!stop && argc != 5) return -1;
  if (stop && argc != 7) return -1;
  if (!decimal(argv[2]) || !safe_field(argv[3]) || !safe_field(argv[4])) return -1;
  uint64_t pid_value;
  if (parse_u64(argv[2], &pid_value) != 0) return -1;
  if (pid_value == 0 || pid_value > INT32_MAX) return -1;
  request->pid = (pid_t)pid_value;
  request->signal_number = SIGTERM;
  request->timeout_ms = 0;
  if (!stop) return 0;
  return parse_stop_options(argv, request);
}

static void report_pidfd_failure(int error, const char *reason) {
  if (error == ESRCH) json_state("absent", NULL);
  else json_state(error == ENOSYS ? "unsupported" : "ambiguous", reason);
}

static int process_command(bool stop, int argc, char **argv) {
  struct process_request request;
  if (parse_process_request(stop, argc, argv, &request) != 0) return 64;
  int descriptor = pidfd_open_exact(request.pid);
  if (descriptor < 0) {
    report_pidfd_failure(errno, "pidfd_open_failed");
    return 0;
  }
  int valid = validate_process(descriptor, request.pid, argv[3], argv[4]);
  if (valid <= 0) {
    close(descriptor);
    json_state(valid == 0 ? "identity_changed" : "ambiguous", "process_identity_failed");
    return 0;
  }
  if (pidfd_signal_exact(descriptor, 0) != 0) {
    int saved = errno;
    close(descriptor);
    report_pidfd_failure(saved, "pidfd_identity_probe_failed");
    return 0;
  }
  if (!stop) {
    close(descriptor);
    json_state("current", NULL);
    return 0;
  }
  if (pidfd_signal_exact(descriptor, request.signal_number) != 0) {
    int saved = errno;
    close(descriptor);
    report_pidfd_failure(saved, "pidfd_send_signal_failed");
    return 0;
  }
  struct pollfd wait_for_exit = { .fd = descriptor, .events = POLLIN };
  int waited;
  do { waited = poll(&wait_for_exit, 1, request.timeout_ms); } while (waited < 0 && errno == EINTR);
  close(descriptor);
  if (waited > 0) json_state("exited", NULL);
  else if (waited == 0) json_state("timeout", NULL);
  else json_state("ambiguous", "pidfd_wait_failed");
  return 0;
}

static const char *entry_type(const struct stat *info) {
  if (S_ISREG(info->st_mode)) return "file";
  if (S_ISDIR(info->st_mode)) return "directory";
  if (S_ISLNK(info->st_mode)) return "symlink";
  return "unsupported";
}

static int descriptor_path_matches(int descriptor, const char *expected_path) {
  char descriptor_path[64];
  char resolved_path[PATH_MAX + 1];
  if (snprintf(descriptor_path, sizeof(descriptor_path), "/proc/self/fd/%d", descriptor)
      >= (int)sizeof(descriptor_path)) return -1;
  ssize_t length = readlink(descriptor_path, resolved_path, PATH_MAX);
  if (length <= 0 || length > PATH_MAX) return -1;
  resolved_path[length] = '\0';
  return strcmp(resolved_path, expected_path) == 0 ? 0 : -1;
}

static int open_parent(const char *parent_path, uint64_t expected_dev, uint64_t expected_ino) {
  int descriptor = open(parent_path, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
  if (descriptor < 0) return -1;
  struct stat info;
  if (fstat(descriptor, &info) != 0 || !S_ISDIR(info.st_mode)
      || (uint64_t)info.st_dev != expected_dev || (uint64_t)info.st_ino != expected_ino
      || info.st_uid != geteuid() || (info.st_mode & 07777) != 0700) {
    close(descriptor);
    errno = ESTALE;
    return -1;
  }
  if (descriptor_path_matches(descriptor, parent_path) != 0) {
    close(descriptor);
    errno = ESTALE;
    return -1;
  }
  return descriptor;
}

static int inspect_at(int parent, const char *name, uint64_t dev, uint64_t ino,
                      const char *type, struct stat *observed) {
  if (fstatat(parent, name, observed, AT_SYMLINK_NOFOLLOW) != 0) return errno == ENOENT ? 0 : -1;
  if ((uint64_t)observed->st_dev != dev || (uint64_t)observed->st_ino != ino
      || strcmp(entry_type(observed), type) != 0) return 2;
  return 1;
}

static int parse_path_args(int argc, char **argv, uint64_t *parent_dev, uint64_t *parent_ino,
                           uint64_t *entry_dev, uint64_t *entry_ino) {
  if (argc < 9 || !safe_field(argv[2]) || !safe_basename(argv[3])
      || !safe_field(argv[8]) || (strcmp(argv[8], "file") != 0 && strcmp(argv[8], "directory") != 0)) return -1;
  return parse_u64(argv[4], parent_dev) | parse_u64(argv[5], parent_ino)
    | parse_u64(argv[6], entry_dev) | parse_u64(argv[7], entry_ino);
}

static int inspect_entry_command(int argc, char **argv) {
  uint64_t parent_dev, parent_ino, entry_dev, entry_ino;
  if (argc != 9 || parse_path_args(argc, argv, &parent_dev, &parent_ino, &entry_dev, &entry_ino) != 0) return 64;
  int parent = open_parent(argv[2], parent_dev, parent_ino);
  if (parent < 0) { json_state("refused", "parent_identity_or_mode_changed"); return 0; }
  struct stat info;
  int state = inspect_at(parent, argv[3], entry_dev, entry_ino, argv[8], &info);
  close(parent);
  if (state == 1) json_state("current", NULL);
  else if (state == 0) json_state("absent", NULL);
  else if (state == 2) json_state("identity_changed", NULL);
  else json_state("ambiguous", "entry_inspection_failed");
  return 0;
}

static int validate_tree(int descriptor, dev_t device);

static int validate_tree_entry(int descriptor, const char *name, dev_t device) {
  struct stat info;
  if (fstatat(descriptor, name, &info, AT_SYMLINK_NOFOLLOW) != 0) return -1;
  if (info.st_dev != device) return -1;
  if (S_ISREG(info.st_mode) || S_ISLNK(info.st_mode)) return 0;
  if (!S_ISDIR(info.st_mode)) return -1;
  int child = openat2_exact(descriptor, name, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (child < 0) return errno == ENOSYS ? -2 : -1;
  int result = validate_tree(child, device);
  close(child);
  return result;
}

static int validate_tree(int descriptor, dev_t device) {
  if (lseek(descriptor, 0, SEEK_SET) < 0) return -1;
  int duplicate = dup(descriptor);
  if (duplicate < 0) return -1;
  DIR *directory = fdopendir(duplicate);
  if (directory == NULL) { close(duplicate); return -1; }
  int result = 0;
  struct dirent *entry;
  errno = 0;
  while ((entry = readdir(directory)) != NULL) {
    if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) continue;
    result = validate_tree_entry(descriptor, entry->d_name, device);
    if (result != 0) break;
    errno = 0;
  }
  if (entry == NULL && errno != 0) result = -1;
  closedir(directory);
  if (lseek(descriptor, 0, SEEK_SET) < 0) result = -1;
  return result;
}

static int remove_tree(int descriptor, dev_t device);

static int remove_tree_entry(int descriptor, const char *name, dev_t device) {
  struct stat info;
  if (fstatat(descriptor, name, &info, AT_SYMLINK_NOFOLLOW) != 0) return -1;
  if (info.st_dev != device) return -1;
  if (S_ISREG(info.st_mode) || S_ISLNK(info.st_mode)) return unlinkat(descriptor, name, 0);
  if (!S_ISDIR(info.st_mode)) return -1;
  int child = openat2_exact(descriptor, name, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (child < 0) return -1;
  int result = remove_tree(child, device);
  close(child);
  if (result != 0) return result;
  return unlinkat(descriptor, name, AT_REMOVEDIR);
}

static int remove_tree(int descriptor, dev_t device) {
  if (lseek(descriptor, 0, SEEK_SET) < 0) return -1;
  int duplicate = dup(descriptor);
  if (duplicate < 0) return -1;
  DIR *directory = fdopendir(duplicate);
  if (directory == NULL) { close(duplicate); return -1; }
  int result = 0;
  struct dirent *entry;
  errno = 0;
  while ((entry = readdir(directory)) != NULL) {
    if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) continue;
    result = remove_tree_entry(descriptor, entry->d_name, device);
    if (result != 0) break;
    errno = 0;
  }
  if (entry == NULL && errno != 0) result = -1;
  closedir(directory);
  return result;
}

static int restore_quarantine(int parent, const char *quarantine, const char *original) {
  struct stat existing;
  if (fstatat(parent, original, &existing, AT_SYMLINK_NOFOLLOW) == 0 || errno != ENOENT) return -1;
  return renameat2_exact(parent, quarantine, original);
}

static int preflight_original(int parent, const char *name, const struct stat *info) {
  if (!S_ISDIR(info->st_mode)) return 0;
  int descriptor = openat2_exact(parent, name, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (descriptor < 0) return errno == ENOSYS ? -2 : -1;
  int result = validate_tree(descriptor, info->st_dev);
  close(descriptor);
  return result;
}

static int quarantine_original(int parent, const char *original, const char *quarantine,
                               uint64_t dev, uint64_t ino, const char *type,
                               struct stat *quarantine_info) {
  if (renameat2_exact(parent, original, quarantine) != 0) return errno == ENOSYS ? -2 : -1;
  int observed = inspect_at(parent, quarantine, dev, ino, type, quarantine_info);
  if (observed == 1) return 0;
  return restore_quarantine(parent, quarantine, original) == 0 ? -3 : -1;
}

static int delete_quarantine(int parent, const char *name, const struct stat *info) {
  if (!S_ISDIR(info->st_mode)) return unlinkat(parent, name, 0);
  int child = openat2_exact(parent, name, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (child < 0) return errno == ENOSYS ? -2 : -1;
  int result = validate_tree(child, info->st_dev);
  if (result == 0) result = remove_tree(child, info->st_dev);
  close(child);
  if (result != 0) return result;
  return unlinkat(parent, name, AT_REMOVEDIR);
}

static bool report_initial_entry_conflict(int original, int quarantine) {
  if (original == 2 || quarantine == 2) {
    json_state("identity_changed", "entry_state_conflict");
    return true;
  }
  if (original < 0 || quarantine < 0 || (original == 1 && quarantine == 1)) {
    json_state("ambiguous", "entry_state_conflict");
    return true;
  }
  return false;
}

static int parse_remove_args(int argc, char **argv, uint64_t *parent_dev, uint64_t *parent_ino,
                             uint64_t *entry_dev, uint64_t *entry_ino) {
  if (argc != 10) return -1;
  if (parse_path_args(argc, argv, parent_dev, parent_ino, entry_dev, entry_ino) != 0) return -1;
  if (!safe_basename(argv[9])) return -1;
  return strncmp(argv[9], QUARANTINE_PREFIX, strlen(QUARANTINE_PREFIX)) == 0 ? 0 : -1;
}

static void report_quarantine_failure(int result) {
  if (result == -2) json_state("unsupported", "quarantine_failed");
  else if (result == -3) json_state("identity_changed", "quarantine_failed");
  else json_state("ambiguous", "quarantine_failed");
}

static int remove_entry_command(int argc, char **argv) {
  uint64_t parent_dev, parent_ino, entry_dev, entry_ino;
  if (parse_remove_args(argc, argv, &parent_dev, &parent_ino, &entry_dev, &entry_ino) != 0) return 64;
  int parent = open_parent(argv[2], parent_dev, parent_ino);
  if (parent < 0) { json_state("refused", "parent_identity_or_mode_changed"); return 0; }
  struct stat original_info, quarantine_info;
  int original = inspect_at(parent, argv[3], entry_dev, entry_ino, argv[8], &original_info);
  int quarantine = inspect_at(parent, argv[9], entry_dev, entry_ino, argv[8], &quarantine_info);
  if (report_initial_entry_conflict(original, quarantine)) { close(parent); return 0; }
  if (original == 0 && quarantine == 0) { close(parent); json_state("absent", NULL); return 0; }
  if (original == 1) {
    int preflight = preflight_original(parent, argv[3], &original_info);
    if (preflight != 0) { close(parent); json_state(preflight == -2 ? "unsupported" : "ambiguous", "descriptor_preflight_failed"); return 0; }
    int moved = quarantine_original(parent, argv[3], argv[9], entry_dev, entry_ino, argv[8], &quarantine_info);
    if (moved != 0) { close(parent); report_quarantine_failure(moved); return 0; }
  }
  int result = delete_quarantine(parent, argv[9], &quarantine_info);
  close(parent);
  if (result == 0) json_state("removed", NULL);
  else if (result == -2) json_state("unsupported", "openat2_unavailable");
  else json_state("ambiguous", "descriptor_relative_delete_failed");
  return 0;
}

static int open_common_dir(const char *common_path, uint64_t expected_dev, uint64_t expected_ino) {
  int descriptor = open(common_path, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
  if (descriptor < 0) return -1;
  struct stat info;
  if (fstat(descriptor, &info) != 0 || !S_ISDIR(info.st_mode)
      || (uint64_t)info.st_dev != expected_dev || (uint64_t)info.st_ino != expected_ino
      || info.st_uid != geteuid() || (info.st_mode & 0022) != 0
      || descriptor_path_matches(descriptor, common_path) != 0) {
    close(descriptor);
    errno = ESTALE;
    return -1;
  }
  if (flock(descriptor, LOCK_EX | LOCK_NB) != 0) {
    int saved = errno;
    close(descriptor);
    errno = saved;
    return -1;
  }
  return descriptor;
}

static int open_admin_parent(int common, dev_t common_device) {
  int descriptor = openat2_exact(common, "worktrees", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (descriptor < 0) return -1;
  struct stat info;
  if (fstat(descriptor, &info) != 0 || !S_ISDIR(info.st_mode) || info.st_dev != common_device
      || info.st_uid != geteuid() || (info.st_mode & 0022) != 0) {
    close(descriptor);
    errno = ESTALE;
    return -1;
  }
  return descriptor;
}

static int read_bounded_text(int descriptor, char *buffer, ssize_t *count) {
  *count = read(descriptor, buffer, PATH_MAX + 63);
  if (*count < 0) return -1;
  char extra;
  if (read(descriptor, &extra, 1) != 0) return -1;
  buffer[*count] = '\0';
  return strnlen(buffer, (size_t)*count) == (size_t)*count ? 0 : -1;
}

static bool stable_regular_file(const struct stat *before, const struct stat *after) {
  if (!S_ISREG(before->st_mode) || !S_ISREG(after->st_mode)) return false;
  if (before->st_dev != after->st_dev || before->st_ino != after->st_ino) return false;
  if (before->st_size != after->st_size) return false;
  if (before->st_mtim.tv_sec != after->st_mtim.tv_sec) return false;
  if (before->st_mtim.tv_nsec != after->st_mtim.tv_nsec) return false;
  if (before->st_ctim.tv_sec != after->st_ctim.tv_sec) return false;
  return before->st_ctim.tv_nsec == after->st_ctim.tv_nsec;
}

static bool exact_git_text(const char *buffer, ssize_t count, const char *expected) {
  size_t expected_length = strlen(expected);
  if ((size_t)count == expected_length) return memcmp(buffer, expected, expected_length) == 0;
  return (size_t)count == expected_length + 1 && buffer[count - 1] == '\n'
    && memcmp(buffer, expected, expected_length) == 0;
}

static int exact_text_file_at(int directory, const char *name, const char *expected) {
  int descriptor = openat2_exact(directory, name, O_RDONLY | O_CLOEXEC);
  if (descriptor < 0) return -1;
  struct stat before;
  struct stat after;
  char buffer[PATH_MAX + 64];
  ssize_t count = 0;
  int result = -1;
  if (fstat(descriptor, &before) == 0 && S_ISREG(before.st_mode)
      && read_bounded_text(descriptor, buffer, &count) == 0
      && exact_git_text(buffer, count, expected) && fstat(descriptor, &after) == 0
      && stable_regular_file(&before, &after)) result = 0;
  close(descriptor);
  return result;
}

static int validate_worktree_backlinks(int artifact_parent, const char *artifact_name,
                                       int admin_parent, const char *admin_name,
                                       const char *registered_admin_name,
                                       const char *artifact_path, const char *common_path) {
  int artifact = openat2_exact(artifact_parent, artifact_name, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  int admin = openat2_exact(admin_parent, admin_name, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (artifact < 0 || admin < 0) {
    if (artifact >= 0) close(artifact);
    if (admin >= 0) close(admin);
    return -1;
  }
  char expected_admin[PATH_MAX + 32];
  char expected_artifact[PATH_MAX + 8];
  int admin_length = snprintf(expected_admin, sizeof(expected_admin),
                              "gitdir: %s/worktrees/%s", common_path, registered_admin_name);
  int artifact_length = snprintf(expected_artifact, sizeof(expected_artifact), "%s/.git", artifact_path);
  int result = -1;
  if (admin_length > 0 && admin_length < (int)sizeof(expected_admin)
      && artifact_length > 0 && artifact_length < (int)sizeof(expected_artifact)
      && exact_text_file_at(artifact, ".git", expected_admin) == 0
      && exact_text_file_at(admin, "gitdir", expected_artifact) == 0) result = 0;
  close(artifact);
  close(admin);
  return result;
}

struct worktree_request {
  uint64_t parent_dev;
  uint64_t parent_ino;
  uint64_t entry_dev;
  uint64_t entry_ino;
  uint64_t common_dev;
  uint64_t common_ino;
  uint64_t admin_dev;
  uint64_t admin_ino;
};

struct worktree_fds {
  int parent;
  int common;
  int admin_parent;
};

struct worktree_entries {
  int artifact;
  int artifact_quarantine;
  int admin;
  int admin_quarantine;
  struct stat artifact_info;
  struct stat artifact_quarantine_info;
  struct stat admin_info;
  struct stat admin_quarantine_info;
};

static int parse_worktree_args(int argc, char **argv, struct worktree_request *request) {
  if (argc != 17) return -1;
  if (parse_path_args(argc, argv, &request->parent_dev, &request->parent_ino,
                      &request->entry_dev, &request->entry_ino) != 0) return -1;
  if (!safe_basename(argv[9]) || strncmp(argv[9], QUARANTINE_PREFIX, strlen(QUARANTINE_PREFIX)) != 0) return -1;
  if (!safe_field(argv[10]) || !safe_basename(argv[13]) || strcmp(argv[16], "directory") != 0) return -1;
  return parse_u64(argv[11], &request->common_dev) | parse_u64(argv[12], &request->common_ino)
    | parse_u64(argv[14], &request->admin_dev) | parse_u64(argv[15], &request->admin_ino);
}

static bool valid_worktree_states(int artifact, int artifact_quarantine,
                                  int admin, int admin_quarantine) {
  if (artifact < 0 || artifact > 1) return false;
  if (artifact_quarantine < 0 || artifact_quarantine > 1) return false;
  if (admin < 0 || admin > 1) return false;
  if (admin_quarantine < 0 || admin_quarantine > 1) return false;
  int state = artifact | (artifact_quarantine << 1) | (admin << 2) | (admin_quarantine << 3);
  return state == 0 || state == 2 || state == 5 || state == 6 || state == 10;
}

static void report_worktree_delete(int result) {
  if (result == 0) json_state("removed", NULL);
  else if (result == -2) json_state("unsupported", "worktree_delete_unavailable");
  else json_state("ambiguous", "worktree_delete_failed");
}

static void close_worktree_fds(struct worktree_fds *fds) {
  if (fds->admin_parent >= 0) close(fds->admin_parent);
  if (fds->common >= 0) close(fds->common);
  if (fds->parent >= 0) close(fds->parent);
}

static int open_worktree_fds(char **argv, const struct worktree_request *request,
                             struct worktree_fds *fds) {
  fds->parent = open_parent(argv[2], request->parent_dev, request->parent_ino);
  fds->common = open_common_dir(argv[10], request->common_dev, request->common_ino);
  int common_error = errno;
  fds->admin_parent = fds->common >= 0
    ? open_admin_parent(fds->common, (dev_t)request->common_dev) : -1;
  if (fds->parent < 0 || fds->common < 0 || fds->admin_parent < 0) {
    const char *reason = fds->parent < 0 ? "worktree_artifact_parent_changed"
      : fds->common < 0 && (common_error == EWOULDBLOCK || common_error == EAGAIN)
        ? "worktree_common_dir_locked"
        : fds->common < 0 ? "worktree_common_dir_changed" : "worktree_admin_parent_changed";
    close_worktree_fds(fds);
    json_state("refused", reason);
    return -1;
  }
  return 0;
}

static void inspect_worktree_entries(char **argv, const struct worktree_request *request,
                                     const struct worktree_fds *fds,
                                     struct worktree_entries *entries) {
  entries->artifact = inspect_at(fds->parent, argv[3], request->entry_dev, request->entry_ino,
                                 argv[8], &entries->artifact_info);
  entries->artifact_quarantine = inspect_at(fds->parent, argv[9], request->entry_dev,
    request->entry_ino, argv[8], &entries->artifact_quarantine_info);
  entries->admin = inspect_at(fds->admin_parent, argv[13], request->admin_dev,
                              request->admin_ino, argv[16], &entries->admin_info);
  entries->admin_quarantine = inspect_at(fds->admin_parent, argv[9], request->admin_dev,
    request->admin_ino, argv[16], &entries->admin_quarantine_info);
}

static bool worktree_identity_changed(const struct worktree_entries *entries) {
  return entries->artifact == 2 || entries->artifact_quarantine == 2
    || entries->admin == 2 || entries->admin_quarantine == 2;
}

static int validate_worktree_evidence(char **argv, const struct worktree_fds *fds,
                                      const struct worktree_entries *entries) {
  const char *artifact_name = entries->artifact == 1 ? argv[3] : argv[9];
  const char *admin_name = entries->admin == 1 ? argv[13] : argv[9];
  char artifact_path[PATH_MAX + 1];
  int length = snprintf(artifact_path, sizeof(artifact_path), "%s/%s", argv[2], argv[3]);
  if (length <= 0 || length >= (int)sizeof(artifact_path)) return -1;
  bool admin_present = entries->admin == 1 || entries->admin_quarantine == 1;
  if (!admin_present) return 0;
  return validate_worktree_backlinks(
    fds->parent, artifact_name, fds->admin_parent, admin_name, argv[13], artifact_path, argv[10]);
}

static int preflight_worktree_entries(char **argv, const struct worktree_fds *fds,
                                      const struct worktree_entries *entries) {
  const char *artifact_name = entries->artifact == 1 ? argv[3] : argv[9];
  const struct stat *artifact_info = entries->artifact == 1
    ? &entries->artifact_info : &entries->artifact_quarantine_info;
  int result = preflight_original(fds->parent, artifact_name, artifact_info);
  if (result != 0) return result;
  if (entries->admin == 0 && entries->admin_quarantine == 0) return 0;
  const char *admin_name = entries->admin == 1 ? argv[13] : argv[9];
  const struct stat *admin_info = entries->admin == 1
    ? &entries->admin_info : &entries->admin_quarantine_info;
  return preflight_original(fds->admin_parent, admin_name, admin_info);
}

static int quarantine_worktree_entries(char **argv, const struct worktree_request *request,
                                       const struct worktree_fds *fds,
                                       struct worktree_entries *entries) {
  bool moved_artifact = false;
  if (entries->artifact == 1) {
    int result = quarantine_original(fds->parent, argv[3], argv[9],
      request->entry_dev, request->entry_ino, argv[8], &entries->artifact_quarantine_info);
    if (result != 0) return result;
    moved_artifact = true;
  }
  if (entries->admin == 1) {
    int result = quarantine_original(fds->admin_parent, argv[13], argv[9],
      request->admin_dev, request->admin_ino, argv[16], &entries->admin_quarantine_info);
    if (result != 0) {
      if (moved_artifact) (void)restore_quarantine(fds->parent, argv[9], argv[3]);
      return result;
    }
    entries->admin_quarantine = 1;
  }
  return 0;
}

static int remove_worktree_command(int argc, char **argv) {
  struct worktree_request request;
  if (parse_worktree_args(argc, argv, &request) != 0) return 64;
  struct worktree_fds fds = { .parent = -1, .common = -1, .admin_parent = -1 };
  if (open_worktree_fds(argv, &request, &fds) != 0) return 0;
  struct worktree_entries entries;
  inspect_worktree_entries(argv, &request, &fds, &entries);
  if (!valid_worktree_states(entries.artifact, entries.artifact_quarantine,
                             entries.admin, entries.admin_quarantine)) {
    json_state(worktree_identity_changed(&entries) ? "identity_changed" : "ambiguous",
               "worktree_state_conflict");
    close_worktree_fds(&fds);
    return 0;
  }
  if (entries.artifact == 0 && entries.artifact_quarantine == 0) {
    close_worktree_fds(&fds); json_state("absent", NULL); return 0;
  }
  if (validate_worktree_evidence(argv, &fds, &entries) != 0) {
    close_worktree_fds(&fds); json_state("identity_changed", "worktree_backlink_changed"); return 0;
  }
  int result = preflight_worktree_entries(argv, &fds, &entries);
  if (result != 0) {
    close_worktree_fds(&fds); report_quarantine_failure(result); return 0;
  }
  result = quarantine_worktree_entries(argv, &request, &fds, &entries);
  if (result != 0) {
    close_worktree_fds(&fds); report_quarantine_failure(result); return 0;
  }
  if (entries.admin_quarantine == 1) {
    result = delete_quarantine(fds.admin_parent, argv[9], &entries.admin_quarantine_info);
  }
  if (result == 0) result = delete_quarantine(fds.parent, argv[9], &entries.artifact_quarantine_info);
  close_worktree_fds(&fds);
  report_worktree_delete(result);
  return 0;
}

static int inspect_worktree_command(int argc, char **argv) {
  struct worktree_request request;
  if (parse_worktree_args(argc, argv, &request) != 0) return 64;
  int parent = open_parent(argv[2], request.parent_dev, request.parent_ino);
  int parent_error = errno;
  int common = open_common_dir(argv[10], request.common_dev, request.common_ino);
  if (common < 0) {
    if (parent >= 0) close(parent);
    json_state("refused", "worktree_common_dir_changed");
    return 0;
  }
  int admin_parent = open_admin_parent(common, (dev_t)request.common_dev);
  int admin_parent_error = errno;
  if (parent < 0 && parent_error != ENOENT) {
    if (admin_parent >= 0) close(admin_parent);
    close(common);
    json_state("refused", "worktree_artifact_parent_changed");
    return 0;
  }
  if (admin_parent < 0 && admin_parent_error != ENOENT) {
    close(common);
    if (parent >= 0) close(parent);
    json_state("refused", "worktree_admin_parent_changed");
    return 0;
  }
  struct stat artifact_info, admin_info;
  int artifact = parent < 0 ? 0 : inspect_at(
    parent, argv[3], request.entry_dev, request.entry_ino, argv[8], &artifact_info);
  int admin = admin_parent < 0 ? 0 : inspect_at(
    admin_parent, argv[13], request.admin_dev, request.admin_ino, argv[16], &admin_info);
  if (admin_parent >= 0) close(admin_parent);
  close(common);
  if (parent >= 0) close(parent);
  if (artifact == 1 && admin == 1) json_state("current", NULL);
  else if (artifact == 0 && admin == 0) json_state("absent", NULL);
  else if (artifact == 2 || admin == 2) json_state("identity_changed", NULL);
  else json_state("ambiguous", "worktree_state_conflict");
  return 0;
}

static bool syscall_available_pidfd(void) {
  int descriptor = pidfd_open_exact(getpid());
  if (descriptor < 0) return false;
  bool available = pidfd_signal_exact(descriptor, 0) == 0;
  close(descriptor);
  return available;
}

static bool syscall_available_openat2(void) {
  int parent = open(".", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (parent < 0) return false;
  int descriptor = openat2_exact(parent, ".", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  bool available = descriptor >= 0;
  if (descriptor >= 0) close(descriptor);
  close(parent);
  return available;
}

static bool syscall_available_renameat2(void) {
#ifdef SYS_renameat2
  errno = 0;
  (void)syscall(SYS_renameat2, -1, "x", -1, "y", RENAME_NOREPLACE);
  return errno != ENOSYS;
#else
  return false;
#endif
}

static int info_command(void) {
  printf("{\"abiVersion\":\"%s\",\"openat2\":%s,\"pidfd\":%s,\"platform\":\"linux\",\"renameat2\":%s}\n",
         ABI_VERSION, syscall_available_openat2() ? "true" : "false",
         syscall_available_pidfd() ? "true" : "false",
         syscall_available_renameat2() ? "true" : "false");
  return 0;
}

int main(int argc, char **argv) {
  if (argc < 2 || !safe_field(argv[1])) return 64;
  if (strcmp(argv[1], "info") == 0 && argc == 2) return info_command();
  if (strcmp(argv[1], "inspect-process") == 0) return process_command(false, argc, argv);
  if (strcmp(argv[1], "stop-process") == 0) return process_command(true, argc, argv);
  if (strcmp(argv[1], "inspect-entry") == 0) return inspect_entry_command(argc, argv);
  if (strcmp(argv[1], "inspect-worktree") == 0) return inspect_worktree_command(argc, argv);
  if (strcmp(argv[1], "remove-entry") == 0) return remove_entry_command(argc, argv);
  if (strcmp(argv[1], "remove-worktree") == 0) return remove_worktree_command(argc, argv);
  return 64;
}
